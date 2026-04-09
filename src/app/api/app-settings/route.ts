import { NextResponse } from 'next/server';
import { getAppConfigResponse, updateAppConfig } from '@/lib/app-config';

export async function GET() {
  try {
    const response = await getAppConfigResponse();
    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to read app settings:', error);
    return NextResponse.json({ error: 'Failed to read app settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await updateAppConfig(body ?? {});
    const response = await getAppConfigResponse();
    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to save app settings:', error);
    return NextResponse.json({ error: 'Failed to save app settings' }, { status: 500 });
  }
}
