import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin/', '/experiment/', '/consent', '/demographics', '/complete', '/withdraw', '/exit', '/api/'] }
    ],
    sitemap: '/sitemap.xml'
  };
}
