import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Chat rooms must never be crawled or indexed.
        disallow: ["/c/", "/api/"],
      },
    ],
  };
}
