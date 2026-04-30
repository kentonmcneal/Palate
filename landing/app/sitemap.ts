import type { MetadataRoute } from "next";
import { STARTER_PERSONAS } from "@/config/starter-personas";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://palate.app";
  const now = new Date();
  const sharePages: MetadataRoute.Sitemap = Object.keys(STARTER_PERSONAS).map((persona) => ({
    url: `${base}/share/${persona}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/resume`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/press`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    ...sharePages,
  ];
}
