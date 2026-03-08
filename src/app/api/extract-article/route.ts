import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type ExtractArticleRequestBody = {
  url?: string;
};

export async function POST(req: NextRequest) {
  let body: ExtractArticleRequestBody;

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body in request." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const rawUrl = body.url?.trim();

  if (!rawUrl) {
    return new Response(JSON.stringify({ error: "URL is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const htmlResponse = await axios.get<string>(parsedUrl.toString(), {
      responseType: "text",
      timeout: 15000,
      headers: {
        // Identify as a regular browser to reduce chances of being blocked.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      // Follow redirects by default; axios will handle common cases.
      maxRedirects: 5,
    });

    const dom = new JSDOM(htmlResponse.data, {
      url: parsedUrl.toString(),
    });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return new Response(
        JSON.stringify({ error: "Could not extract readable article content." }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const hostname = parsedUrl.hostname.replace(/^www\./i, "");

    return new Response(
      JSON.stringify({
        url: parsedUrl.toString(),
        domain: hostname,
        title: article.title || parsedUrl.toString(),
        byline: article.byline ?? null,
        excerpt: article.excerpt ?? null,
        content: article.content, // HTML string
        textContent: article.textContent ?? null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error extracting article", error);

    return new Response(
      JSON.stringify({
        error:
          "Failed to fetch or parse the article. The site may be blocking automated requests.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

