import { readFileSync } from "fs";
import { resolve } from "path";
import ts from "typescript";

// Offline source contract: a field-mask edit must be reviewed against Google's
// documented SKU table, not silently keep an older/lower reservation price.
// Sources and dated rates are recorded in GOOGLE_FIELD_PRICING_20260929.md.
const root = resolve(__dirname, "../../../supabase/functions");
const enterprise = new Set("priceLevel rating userRatingCount regularOpeningHours".split(" "));
const atmosphere = new Set("editorialSummary reviews goodForGroups goodForChildren menuForChildren goodForWatchingSports liveMusic reservable outdoorSeating servesBreakfast servesBrunch servesLunch servesDinner servesBeer servesWine servesCocktails servesVegetarianFood servesDessert allowsDogs delivery takeout dineIn".split(" "));
const structural = new Set("id displayName formattedAddress shortFormattedAddress addressComponents location primaryType types businessStatus nextPageToken".split(" "));

function parse(file: string) {
  const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  const definitions = new Map<string, ts.Expression>();
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer);
    if (ts.isCallExpression(node) && node.expression.getText(source) === "spendGoogle") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  function evaluate(node: ts.Expression, env: Record<string, unknown> = {}): unknown {
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return evaluate(node.expression, env);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ""));
    if (ts.isIdentifier(node)) {
      if (Object.prototype.hasOwnProperty.call(env, node.text)) return env[node.text];
      const init = definitions.get(node.text);
      if (init) return evaluate(init, env);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return String(evaluate(node.left, env)) + String(evaluate(node.right, env));
    if (ts.isConditionalExpression(node)) return evaluate(evaluate(node.condition, env) ? node.whenTrue : node.whenFalse, env);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = definitions.get(node.expression.text);
      if (fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
        const local = { ...env };
        fn.parameters.forEach((p, i) => { local[p.name.getText(source)] = evaluate(node.arguments[i], env); });
        return evaluate(fn.body, local);
      }
    }
    throw Error(`Unreviewed expression: ${node.getText(source)}`);
  }
  function property(node: ts.Expression, key: string): ts.Expression {
    if (!ts.isObjectLiteralExpression(node)) throw Error("Expected explicit request object");
    const p = node.properties.find(p => ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(source)) === key);
    if (!p || !ts.isPropertyAssignment(p)) throw Error(`Missing explicit ${key}`);
    return p.initializer;
  }
  return { source, definitions, calls, evaluate, property };
}

test("every current paid Places mask is assigned its documented Enterprise tier", () => {
  let variants = 0;
  for (const file of ["places-proxy/index.ts", "featured-lists-refresh/index.ts", "reclassify/index.ts"]) {
    const p = parse(file);
    for (const call of p.calls) {
      const opts = call.arguments[0];
      const header = p.property(p.property(p.property(opts, "init"), "headers"), "X-Goog-FieldMask");
      for (const wantReviews of file.startsWith("reclassify/") ? [false, true] : [false]) {
        const mask = String(p.evaluate(header, { wantReviews }));
        const fields = mask.split(",").map(f => f.replace(/^places\./, ""));
        expect(fields.length).toBeGreaterThan(0);
        for (const field of fields) expect(structural.has(field) || enterprise.has(field) || atmosphere.has(field)).toBe(true);
        const tier = fields.some(f => atmosphere.has(f)) ? "enterprise_atmosphere" : fields.some(f => enterprise.has(f)) ? "enterprise" : "pro";
        const url = p.property(opts, "url").getText(p.source);
        const endpoint = url.includes(":searchNearby") ? "search_nearby" : url.includes(":searchText") ? "search_text" : "details";
        expect(p.evaluate(p.property(opts, "sku"), { wantReviews })).toBe(`${endpoint}_${tier}`);
        variants++;
      }
    }
  }
  expect(variants).toBe(6);
});

test("reservation rates use the global first paid tier without credits or discounts", () => {
  const p = parse("_shared/google-spend.ts");
  const table = p.definitions.get("SKU_MICROS")!;
  for (const [sku, micros] of Object.entries({ details_enterprise: 20000, details_enterprise_atmosphere: 25000, search_text_enterprise: 35000, search_nearby_enterprise: 35000, ids_only: 0 })) {
    expect(p.evaluate(p.property(table, sku))).toBe(micros);
  }
});

test("the Gmail free-search exception requests IDs only", () => {
  const source = readFileSync(resolve(root, "gmail-import/index.ts"), "utf8");
  const ast = ts.createSourceFile("gmail.ts", source, ts.ScriptTarget.Latest, true);
  const p = parse("gmail-import/index.ts");
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "fetch" && node.arguments[0]?.getText(ast).includes("places.googleapis.com")) {
      expect(node.arguments[0].getText(ast)).toContain("/v1/places:searchText");
      const headers = p.property(node.arguments[1], "headers");
      expect(p.evaluate(p.property(headers, "X-Goog-FieldMask"))).toBe("places.id");
      count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(count).toBe(1);
});
