// Called only inside protectEndpoint's authenticated maintenance handler.
export async function lifecycleHealthResponse(request: Request): Promise<Response | null> {
  try {
    const payload = await request.json();
    if (payload?.healthCheck === true) return Response.json({ ok: true, mode: 'health', maintenanceExecuted: false });
  } catch { /* Existing scheduled requests may have an empty body. */ }
  return null;
}
