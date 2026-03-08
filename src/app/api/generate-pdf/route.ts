import type { NextRequest } from "next/server";
import puppeteer from "puppeteer";
import { JSDOM } from "jsdom";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";

type ArticleForPdf = {
  title: string;
  url: string;
  domain?: string | null;
  byline?: string | null;
  content: string; // HTML content from Readability
};

type GeneratePdfRequestBody = {
  articles?: ArticleForPdf[];
};

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBroadsheetDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function extractLeadFigureAndTagLeadParagraph(contentHtml: string): {
  leadFigureHtml: string | null;
  contentHtml: string;
} {
  try {
    const dom = new JSDOM(`<body>${contentHtml}</body>`);
    const doc = dom.window.document;

    // Tag first paragraph for drop cap styling.
    const firstParagraph = doc.querySelector("p");
    if (firstParagraph) firstParagraph.classList.add("lead");

    // Prefer a <figure> containing an <img> as the lead, else first <img>.
    const figureWithImg = doc.querySelector("figure:has(img)");
    const imgEl = doc.querySelector("img");

    let leadFigureHtml: string | null = null;

    if (figureWithImg) {
      const leadFigure = figureWithImg.cloneNode(true) as HTMLElement;
      leadFigure.classList.add("lead-figure");
      leadFigureHtml = leadFigure.outerHTML;
      figureWithImg.remove();
    } else if (imgEl) {
      const img = imgEl.cloneNode(true) as HTMLImageElement;
      img.classList.add("lead-image");
      const captionText = img.getAttribute("alt")?.trim();
      leadFigureHtml = `
        <figure class="lead-figure">
          ${img.outerHTML}
          ${
            captionText
              ? `<figcaption class="lead-caption">${escapeHtml(captionText)}</figcaption>`
              : ""
          }
        </figure>
      `;
      imgEl.remove();
    }

    return {
      leadFigureHtml,
      contentHtml: doc.body.innerHTML,
    };
  } catch {
    return { leadFigureHtml: null, contentHtml };
  }
}

function buildExcerptFromHtml(html: string, maxChars = 260): string {
  try {
    const dom = new JSDOM(`<body>${html}</body>`);
    const text = dom.window.document.body.textContent ?? "";
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars).trimEnd()}…`;
  } catch {
    return "";
  }
}

function buildHtmlDocument(articles: ArticleForPdf[]): string {
  const publicationTitle = "The Offline Broadsheet";
  const issueDate = formatBroadsheetDate(new Date());

  const teaserSections = articles
    .slice(0, 2)
    .map((article) => {
      const safeTitle = escapeHtml(article.title || article.url);
      const safeDomain = escapeHtml(article.domain ?? "");
      const excerpt = buildExcerptFromHtml(article.content);
      const hasByline = Boolean(article.byline && article.byline.trim().length > 0);

      return `
        <article class="teaser">
          <h2 class="teaser-title">${safeTitle}</h2>
          ${
            hasByline
              ? `<p class="teaser-byline">${escapeHtml(article.byline!.trim())}</p>`
              : ""
          }
          <p class="teaser-meta">${safeDomain}</p>
          ${
            excerpt
              ? `<p class="teaser-excerpt">${escapeHtml(excerpt)}</p>`
              : ""
          }
          <p class="teaser-continue">Continued on next page \u2192</p>
        </article>
      `;
    })
    .join("\n");

  const articleSections = articles
    .map((article, index) => {
      const safeTitle = escapeHtml(article.title || article.url);
      const safeDomain = article.domain ?? "";
      const sourceLineRaw = [safeDomain, article.url]
        .filter(Boolean)
        .join(" \u2022 ");
      const sourceLine = escapeHtml(sourceLineRaw);
      const hasByline = Boolean(article.byline && article.byline.trim().length > 0);
      const separator =
        index === 0
          ? ""
          : `<hr class="article-separator" aria-hidden="true" />`;
      const articleClass =
        index === 0 ? "article article--lead" : "article";

      const { leadFigureHtml, contentHtml } =
        extractLeadFigureAndTagLeadParagraph(article.content);

      return `
        ${separator}
        <article class="${articleClass}">
          <header class="article-header">
            <h1 class="article-title">${safeTitle}</h1>
            ${
              hasByline
                ? `<p class="article-byline">${escapeHtml(article.byline!.trim())}</p>`
                : ""
            }
            <p class="article-meta">${sourceLine}</p>
          </header>
          ${leadFigureHtml ?? ""}
          <section class="article-body">
            ${contentHtml}
          </section>
        </article>
      `;
    })
    .join("\n");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Saved Articles</title>
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Newsreader:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&display=swap");

          @page {
            margin: 60px;
          }

          * {
            box-sizing: border-box;
          }

          html {
            background-color: white;
          }

          body {
            margin: 0;
            padding: 0;
            font-family: "Source Serif 4", "Georgia", "Times New Roman", serif;
            color: #111827;
            background-color: white;
          }

          main {
            max-width: 860px;
            margin: 0 auto;
            padding: 6mm 0 8mm 0;
          }

          .masthead {
            min-height: 150px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            margin: 0 0 6mm 0;
          }

          .masthead-title {
            font-family: "Newsreader", "Times New Roman", serif;
            font-weight: 700;
            font-size: 30pt;
            letter-spacing: 0.02em;
            margin: 0;
          }

          .masthead-date {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 9pt;
            color: #374151;
            margin: 1.5mm 0 0 0;
            text-transform: uppercase;
            letter-spacing: 0.12em;
          }

          .masthead-rule {
            border: none;
            border-top: 3px solid #111827;
            margin: 4mm 0 6mm 0;
          }

          .front-page {
            margin-bottom: 8mm;
          }

          .front-page-label {
            font-family: "Newsreader", "Times New Roman", serif;
            font-size: 18pt;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #4b5563;
            margin: 0 0 3mm 0;
          }

          .front-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 4mm 6mm;
          }

          .teaser {
            padding-right: 2mm;
            border-right: 1px solid #e5e7eb;
          }

          .teaser:nth-child(2n) {
            border-right: none;
          }

          .teaser-title {
            font-family: "Newsreader", "Times New Roman", serif;
            font-size: 20pt;
            font-weight: 600;
            line-height: 1.2;
            margin: 0 0 1mm 0;
            color: #111827;
          }

          .teaser-byline {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 9pt;
            font-weight: 500;
            color: #6b7280;
            margin: 0 0 0.5mm 0;
          }

          .teaser-meta {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 8pt;
            color: #9ca3af;
            margin: 0 0 1.5mm 0;
          }

          .teaser-excerpt {
            font-size: 9.5pt;
            line-height: 1.5;
            color: #111827;
            margin: 0 0 1.5mm 0;
          }

          .teaser-continue {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 8.5pt;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #1f2937;
            margin: 0;
          }

          .article-separator {
            border: none;
            border-top: 2px solid #111827;
            margin: 0 0 6mm 0;
          }

          .article {
            break-inside: auto;
            page-break-inside: auto;
            padding: 0 1mm 4mm 1mm;
          }

          .article.article--lead .article-body {
            column-count: 2;
            column-width: 280px;
          }

          .article-header {
            margin-bottom: 3mm;
          }

          .article-title {
            font-family: "Newsreader", "Times New Roman", serif;
            font-size: 54px;
            line-height: 1.05;
            margin: 0 0 1.5mm 0;
            font-weight: 600;
            color: #111827;
          }

          .article-byline {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 10pt;
            font-weight: 500;
            color: #6b7280;
            margin: 0 0 1mm 0;
          }

          .article-meta {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 8.5pt;
            color: #6b7280;
            margin: 0;
            word-break: break-all;
          }

          .lead-figure {
            margin: 4mm 0 4mm 0;
          }

          .lead-figure img,
          .lead-image {
            width: 100%;
            height: auto;
            display: block;
            border: 1px solid #e5e7eb;
            max-height: 50vh;
            object-fit: contain;
          }

          .lead-figure figcaption,
          .lead-caption {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 8.5pt;
            color: #4b5563;
            margin-top: 2mm;
            line-height: 1.35;
          }

          .article-body {
            font-size: 10.75pt;
            line-height: 1.6;
            color: #111827;
            column-count: 3;
            column-width: 240px;
            column-gap: 20px;
            column-fill: balance;
          }

          .article-body p {
            margin: 0 0 3mm 0;
          }

          .article-body p.lead::first-letter {
            float: left;
            font-family: "Newsreader", "Times New Roman", serif;
            font-weight: 700;
            font-size: 56px;
            line-height: 0.9;
            padding-right: 8px;
            padding-top: 4px;
            color: #111827;
          }

          .article-body h1,
          .article-body h2,
          .article-body h3,
          .article-body h4 {
            font-family: "Newsreader", "Times New Roman", serif;
            margin: 4mm 0 2mm 0;
            line-height: 1.25;
            break-after: avoid-column;
            break-inside: avoid-column;
          }

          .article-body ul,
          .article-body ol {
            margin: 0 0 3mm 1.5em;
          }

          .article-body li {
            margin: 0 0 1.5mm 0;
          }

          .article-body img {
            max-width: 100%;
            height: auto;
            margin: 3mm 0;
            display: block;
            break-inside: avoid-column;
            page-break-inside: avoid;
            max-height: 50vh;
            object-fit: contain;
          }

          /* Prevent awkward breaks inside common Readability wrappers. */
          .article-body blockquote,
          .article-body pre,
          .article-body table {
            break-inside: avoid-column;
          }

          .article-body a {
            color: #1d4ed8;
            text-decoration: none;
          }

          .article-body a::after {
            content: " \u2197";
            font-size: 8pt;
          }
        </style>
      </head>
      <body>
        <main>
          <header class="masthead">
            <h1 class="masthead-title">${escapeHtml(publicationTitle)}</h1>
            <p class="masthead-date">${escapeHtml(issueDate)}</p>
            <hr class="masthead-rule" aria-hidden="true" />
          </header>
          <section class="front-page">
            <h2 class="front-page-label">In this issue</h2>
            <div class="front-grid">
              ${teaserSections}
            </div>
          </section>
          ${articleSections}
        </main>
      </body>
    </html>
  `;
}

export async function POST(req: NextRequest) {
  let body: GeneratePdfRequestBody;

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

  const articles = body.articles ?? [];

  if (!Array.isArray(articles) || articles.length === 0) {
    return new Response(
      JSON.stringify({ error: "At least one article is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const normalizedArticles: ArticleForPdf[] = articles
    .map((a) => ({
      title: a.title?.trim() || a.url,
      url: a.url,
      domain: a.domain ?? null,
      byline: a.byline ?? null,
      content: a.content,
    }))
    .filter((a) => a.url && a.content);

  if (normalizedArticles.length === 0) {
    return new Response(
      JSON.stringify({
        error: "No valid articles were provided. Each article needs a URL and content.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const html = buildHtmlDocument(normalizedArticles);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfUint8Array = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0px",
        bottom: "0px",
        left: "0px",
        right: "0px",
      },
    });

    await browser.close();

    const pdfBuffer = Buffer.from(pdfUint8Array);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="articles.pdf"',
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (error) {
    console.error("Error generating PDF", error);

    return new Response(
      JSON.stringify({
        error: "Failed to generate PDF.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

