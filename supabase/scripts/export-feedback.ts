// Export all Palate feedback into ONE local folder you can drop into Claude Code.
//
// Quick start:
//   cd supabase/scripts
//   npm install                        # one-time
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx export-feedback.ts
//
// Writes ./feedback-export/ :
//   feedback.md              human-readable, newest first, grouped by category
//   feedback.csv            spreadsheet-friendly
//   screenshots/<id>.<ext>  any attached screenshots (downloaded from the bucket)
//
// Then just drag the feedback-export folder into a Claude Code chat.
//
// Flags:
//   --since=YYYY-MM-DD   only feedback on/after this date
//   --out=DIR            output dir (default ./feedback-export)
//
// Read-only against the DB. Uses the service-role key (bypasses RLS) so it can
// read every user's feedback and download private screenshots. Never paste that
// key into chat — keep it in your terminal env.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const SINCE = args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? null;
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "./feedback-export";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Row = {
  id: string;
  user_id: string | null;
  category: string;
  message: string;
  screenshot_path: string | null;
  app_version: string | null;
  platform: string | null;
  device: string | null;
  os_version: string | null;
  context: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  let query = supabase.from("feedback").select("*").order("created_at", { ascending: false });
  if (SINCE) query = query.gte("created_at", SINCE);
  const { data, error } = await query;
  if (error) { console.error("Query failed:", error.message); process.exit(1); }

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    console.log(SINCE ? `No feedback since ${SINCE}.` : "No feedback yet.");
    return;
  }

  // Fresh output folder each run so the export is a clean snapshot.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "screenshots"), { recursive: true });

  // Download screenshots.
  let shots = 0;
  for (const r of rows) {
    if (!r.screenshot_path) continue;
    const { data: blob, error: dlErr } = await supabase.storage.from("feedback").download(r.screenshot_path);
    if (dlErr || !blob) { console.warn(`  ! screenshot for ${r.id} failed: ${dlErr?.message ?? "no data"}`); continue; }
    const ext = (r.screenshot_path.split(".").pop() || "jpg").toLowerCase();
    const buf = Buffer.from(await blob.arrayBuffer());
    writeFileSync(join(OUT, "screenshots", `${r.id}.${ext}`), buf);
    shots++;
  }

  // Markdown, grouped by category, newest first.
  const emoji: Record<string, string> = { bug: "🐞", idea: "💡", confusing: "🤔", love: "❤️", other: "•" };
  const byCat = new Map<string, Row[]>();
  for (const r of rows) { (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r); }

  let md = `# Palate feedback export\n\n`;
  md += `${rows.length} item(s)${SINCE ? ` since ${SINCE}` : ""} · ${shots} screenshot(s)\n\n`;
  for (const [cat, items] of byCat) {
    md += `## ${emoji[cat] ?? "•"} ${cat} (${items.length})\n\n`;
    for (const r of items) {
      const when = r.created_at.replace("T", " ").slice(0, 16);
      const who = (r.context?.email as string) ?? r.user_id ?? "unknown";
      md += `### ${when} — ${who}\n\n`;
      md += `${r.message}\n\n`;
      const meta = [r.platform, r.device, r.os_version && `iOS/Android ${r.os_version}`, r.app_version && `v${r.app_version}`, r.context?.route && `screen: ${r.context.route}`]
        .filter(Boolean).join(" · ");
      if (meta) md += `_${meta}_\n\n`;
      if (r.screenshot_path) md += `![screenshot](screenshots/${r.id}.${(r.screenshot_path.split(".").pop() || "jpg").toLowerCase()})\n\n`;
      md += `---\n\n`;
    }
  }
  writeFileSync(join(OUT, "feedback.md"), md);

  // CSV.
  const cols = ["created_at", "category", "status", "message", "app_version", "platform", "device", "os_version", "email", "route", "screenshot"];
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at, r.category, r.status, r.message, r.app_version, r.platform, r.device, r.os_version,
      r.context?.email ?? "", r.context?.route ?? "",
      r.screenshot_path ? `screenshots/${r.id}.${(r.screenshot_path.split(".").pop() || "jpg").toLowerCase()}` : "",
    ].map(csvCell).join(","));
  }
  writeFileSync(join(OUT, "feedback.csv"), lines.join("\n"));

  console.log(`Exported ${rows.length} item(s) and ${shots} screenshot(s) to ${OUT}/`);
  console.log(`  ${join(OUT, "feedback.md")}`);
  console.log(`  ${join(OUT, "feedback.csv")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
