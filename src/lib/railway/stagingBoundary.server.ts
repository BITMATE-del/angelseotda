/**
 * Fail-closed Railway staging perimeter. This runs BEFORE TanStack Start,
 * including server functions, API routes and SSR loaders. A browser-only
 * route gate is NOT an authorization boundary.
 *
 * The legacy app remains intact for non-staging production deployment.
 */
export const STAGING_PAGE_PATH = "/telegram";
const STAGING_ENDPOINTS = new Set([
  "/api/public/railway-auth",
  "/api/public/railway-rooms",
  "/api/public/railway-wallet",
]);
const STATIC_PREFIXES = ["/assets/","/_build/","/brand/","/cards/","/fonts/"];
const STATIC_FILES = new Set(["/favicon.png","/robots.txt"]);
const READ_METHODS = new Set(["GET","HEAD"]);

export function isRailwayIsolatedStaging(environment:NodeJS.ProcessEnv):boolean{
  return environment['BACKEND_MODE']==="railway_postgres_staging" &&
    environment['RAILWAY_ENVIRONMENT_NAME']==="staging";
}
export type StagingDecision="ALLOW"|"REDIRECT"|"DENY";
export function classifyStagingRequest(pathname:string,method:string):StagingDecision{
  if(pathname==="/" && READ_METHODS.has(method))return "REDIRECT";
  if(STAGING_ENDPOINTS.has(pathname))return "ALLOW";
  if(pathname===STAGING_PAGE_PATH && READ_METHODS.has(method))return "ALLOW";
  if(READ_METHODS.has(method) &&
     (STATIC_FILES.has(pathname)||STATIC_PREFIXES.some(prefix=>pathname.startsWith(prefix))))
    return "ALLOW";
  return "DENY";
}
export function enforceRailwayStagingBoundary(request:Request,environment:NodeJS.ProcessEnv):Response|null{
  if(!isRailwayIsolatedStaging(environment))return null;
  const url=new URL(request.url);
  const decision=classifyStagingRequest(url.pathname,request.method);
  if(decision==="ALLOW")return null;
  if(decision==="REDIRECT")return new Response(null,{
    status:307,
    headers:{location:STAGING_PAGE_PATH,"Cache-Control":"no-store"},
  });
  // Explicitly block legacy Supabase Auth, server functions, webhook,
  // crypto watcher, settlement, wallet, admin and affiliate routes.
  return Response.json({error:"STAGING_ROUTE_NOT_AVAILABLE"},{status:404,
    headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
