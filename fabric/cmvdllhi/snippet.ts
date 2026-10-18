import { NextResponse } from 'next/server';

// פונקציה לטיפול בבקשות API קשורות לדיווחי זיכרון
export async function handleMemoryReports(request: Request) {
  // בדיקת הנתיב והמתודה
  const { pathname } = new URL(request.url);
  
  // נתיבים שקשורים לדיווחי זיכרון שיש להסיר
  const memoryReportPaths = [
    '/api/status/memory',
    '/api/evolution/memory-leaks',
    '/api/diagnostics/memory-usage'
  ];
  
  // אם הנתיב תואם לדיווחי זיכרון, מחזירת תגובה מתאימה
  if (memoryReportPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.json({
      status: 'deprecated',
      message: 'דיווחי זיכרון הוסרו מכיוון שהמערכת היא סטטית ודטרמיניסטית',
      systemType: 'static_simulation'
    }, { status: 410 }); // 410 Gone - מציין שהמשאב אינו זמין עוד
  }
  
  // אם זו בקשה כללית לניהול זיכרון, מחזירת שגיאה
  if (pathname.startsWith('/api/memory-management')) {
    return NextResponse.json({
      error: 'ניהול זיכרון דינמי אינו נתמך במערכת סטטית זו',
      systemType: 'static_simulation'
    }, { status: 400 });
  }
  
  // אם לא קשור לדיווחי זיכרון, ממשיכים עם הטיפול הרגיל
  return NextResponse.next();
}

// מידלוור לסינון בקשות קשורות לזיכרון
export function middleware(request: Request) {
  return handleMemoryReports(request);
}

// הגדרת הנתיבים עבור המידלוור
export const config = {
  matcher: ['/api/:path*']
};