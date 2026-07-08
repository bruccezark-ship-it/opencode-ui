function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

function extractMeta(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return '';
}

function extractMainRegion(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const regionPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+id=["']app["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+id=["']root["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of regionPatterns) {
    const match = withoutScripts.match(pattern);
    if (match?.[1] && stripHtmlToText(match[1]).length > 30) {
      return match[1];
    }
  }

  const bodyMatch = withoutScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] ?? withoutScripts;
}

function extractBodyText(html: string): string {
  return stripHtmlToText(extractMainRegion(html));
}

export function htmlToLlmMarkdown(html: string, url: string, routePath: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeHtmlEntities(titleMatch?.[1]?.trim() ?? '');
  const description = extractMeta(html, 'description');
  const bodyText = extractBodyText(html);

  const heading = title || routePath;
  const lines = [
    '---',
    `url: ${url}`,
    `route: ${routePath}`,
    `title: ${title}`,
  ];

  if (description) {
    lines.push(`description: ${description}`);
  }

  lines.push('---', '', `# ${heading}`, '');

  if (description) {
    lines.push(description, '');
  }

  if (bodyText.length > 30) {
    lines.push(bodyText);
  } else {
    lines.push('> 页面正文未能从 HTML 中提取，可能为 SPA 壳页面或页面加载未完成。');
  }

  lines.push('');
  return lines.join('\n');
}
