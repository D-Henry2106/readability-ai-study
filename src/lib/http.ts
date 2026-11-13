import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { StudyRunError } from '@/lib/study-run/errors';

export function jsonError(error: unknown): NextResponse {
  // Study Run / invitation services fail with a stable code and an HTTP-style status (never a token or hash).
  if (error instanceof StudyRunError) return NextResponse.json({ error: error.code, code: error.code, details: error.details }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Dữ liệu gửi lên không hợp lệ.', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });
  if (message === 'FORBIDDEN') return NextResponse.json({ error: 'Bạn không có quyền thực hiện thao tác này.' }, { status: 403 });
  if (message === 'CONSENT_ALREADY_RECORDED') return NextResponse.json({ error: 'Quyết định đồng ý trước đó đã được ghi nhận.' }, { status: 409 });
  if (message === 'INCOMPLETE_EXPERIMENT') return NextResponse.json({ error: 'Thiếu kết quả đọc hoặc câu hỏi bắt buộc.' }, { status: 409 });
  if (message === 'SESSION_NOT_FOUND') return NextResponse.json({ error: 'Không tìm thấy phiên nghiên cứu.' }, { status: 404 });
  if (message.startsWith('INVALID_STAGE:')) {
    return NextResponse.json({ error: 'Hiện không thể truy cập bước này.', redirectTo: message.split(':')[1] }, { status: 409 });
  }
  if (message.startsWith('EXPERIMENT_NOT_READY:')) {
    return NextResponse.json({ error: 'Nghiên cứu chưa sẵn sàng.', missing: message.split(':')[1]?.split(',') ?? [] }, { status: 503 });
  }
  if (message.startsWith('NEEDS_PROTOCOL_VALUE:')) {
    return NextResponse.json({ error: 'Thiếu cấu hình bắt buộc của nghiên cứu.', missing: message.split(':')[1] }, { status: 503 });
  }
  if (message.startsWith('PACKAGE_INVALID:')) return NextResponse.json({ error: 'Bộ nội dung không đủ điều kiện xuất bản.', missing: message.slice('PACKAGE_INVALID:'.length).split(',') }, { status: 409 });
  if (['PACKAGE_NOT_EDITABLE','NO_ELIGIBLE_PACKAGE','FIXED_PACKAGE_REQUIRED','MAIN_RANDOM_NOT_APPROVED','LEXICAL_INTEGRITY_FAILED'].includes(message)) return NextResponse.json({ error: 'Bộ nội dung hoặc cách phân công chưa hợp lệ.', code: message }, { status: 409 });
  if (message.includes('INVALID_') || message.includes('NOT_STARTED') || message.includes('NOT_ACTIVE')) {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ ở bước nghiên cứu hiện tại.' }, { status: 400 });
  }

  console.error('Unhandled server error (type only):', error instanceof Error ? error.name : 'Unknown');
  return NextResponse.json({ error: 'Có lỗi máy chủ. Vui lòng thử lại.' }, { status: 500 });
}

/** 429 with Retry-After; never include the identifier that was throttled. */
export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', retryAfterSeconds: seconds },
    { status: 429, headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' } }
  );
}

/**
 * Wraps a canonical route handler so a legacy URL runs the exact same code (same auth, roles,
 * checklist and publish rules) and only adds deprecation headers. Aliases must never hold logic.
 */
export function deprecatedAlias<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
  successorPath: string
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const response = await handler(...args);
    response.headers.set('Deprecation', 'true');
    response.headers.set('Link', `<${successorPath}>; rel="successor-version"`);
    return response;
  };
}
