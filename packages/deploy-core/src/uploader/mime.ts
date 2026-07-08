import mime from 'mime-types';

const HASHED_ASSET_REGEX = /\.[a-f0-9]{8,}\.(js|css|mjs)$/i;

export function getContentType(filePath: string): string {
  return mime.lookup(filePath) || 'application/octet-stream';
}

export function getCacheControl(filePath: string): string {
  const basename = filePath.split(/[/\\]/).pop() ?? filePath;

  if (basename === 'index.html' || basename.endsWith('.html')) {
    return 'no-cache, no-store, must-revalidate';
  }

  if (HASHED_ASSET_REGEX.test(basename) || basename.endsWith('.js') || basename.endsWith('.css')) {
    return 'public, max-age=31536000, immutable';
  }

  const ext = basename.split('.').pop()?.toLowerCase();
  if (ext && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'eot'].includes(ext)) {
    return 'public, max-age=2592000';
  }

  return 'public, max-age=3600';
}
