import type { MetadataRoute } from 'next';
import { getAppEnv } from '@/config/env';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: getAppEnv().APP_URL, changeFrequency: 'monthly', priority: 1 }];
}
