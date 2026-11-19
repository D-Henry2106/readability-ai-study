import { redirect } from 'next/navigation';

/** The administrator action log now lives in Research Logs, so old bookmarks keep working. */
export default function Page() {
  redirect('/admin/logs?view=admin');
}
