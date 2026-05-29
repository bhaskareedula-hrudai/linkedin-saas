import { NextRequest, NextResponse } from 'next/server';
import { runAutomation } from '@/lib/automation';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    // Support both direct user_id and nested payload.user_id (legacy shape)
    const payload = body?.payload ?? body;
    const userId =
      typeof payload?.user_id === 'string' ? payload.user_id.trim() : '';

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json(
        { success: false, error: 'Valid user_id is required' },
        { status: 400 }
      );
    }

    const result = await runAutomation(userId);
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error: any) {
    console.error('[trigger-make] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Automation failed' },
      { status: 500 }
    );
  }
}
