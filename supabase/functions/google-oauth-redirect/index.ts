Deno.serve((req) => {
  const url = new URL(req.url);
  const params = url.searchParams.toString();
  const redirectTo = `daywise://oauth2redirect${params ? "?" + params : ""}`;
  return Response.redirect(redirectTo, 302);
});
