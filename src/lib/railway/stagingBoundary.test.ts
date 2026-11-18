import {describe,expect,it} from "vitest";
import {classifyStagingRequest,enforceRailwayStagingBoundary,isRailwayIsolatedStaging} from "./stagingBoundary.server";
const env={BACKEND_MODE:"railway_postgres_staging",RAILWAY_ENVIRONMENT_NAME:"staging"} as NodeJS.ProcessEnv;
const req=(path:string,method="GET")=>new Request("https://preview.example"+path,{method});
describe("Railway isolation: no legacy Supabase endpoints or server functions",()=>{
  it("only activates in the isolated Railway staging environment",()=>{
    expect(isRailwayIsolatedStaging(env)).toBe(true);
    expect(enforceRailwayStagingBoundary(req("/api/public/crypto-watcher"),{} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("allows only Telegram preview endpoints and safe static resources",()=>{
    expect(classifyStagingRequest("/telegram","GET")).toBe("ALLOW");
    expect(classifyStagingRequest("/api/public/railway-auth","POST")).toBe("ALLOW");
    expect(classifyStagingRequest("/api/public/railway-rooms","GET")).toBe("ALLOW");
    expect(classifyStagingRequest("/api/public/railway-wallet","GET")).toBe("ALLOW");
    expect(classifyStagingRequest("/cards/hwatu/base/01-gwang.png","GET")).toBe("ALLOW");
    expect(classifyStagingRequest("/assets/main.js","GET")).toBe("ALLOW");
    expect(classifyStagingRequest("/","GET")).toBe("REDIRECT");
    expect(classifyStagingRequest("/","POST")).toBe("DENY");
  });
  it.each([
    ["/api/public/telegram/webhook","POST"],
    ["/api/public/crypto-watcher","POST"],
    ["/wallet","GET"],
    ["/admin","GET"],
    ["/affiliate","GET"],
    ["/game/legacy-room","GET"],
    ["/dori/game/legacy-room","GET"],
    ["/_serverFn/bet","POST"],
    ["/api/private/settle","POST"],
    ["/auth","GET"],
    ["/api/public/railway-rooms/unknown","GET"],
    ["/telegram","POST"],
    ["/cards/hwatu/base/01-gwang.png","POST"],
  ])("blocks legacy request %s %s",async(path,method)=>{
    const denied=enforceRailwayStagingBoundary(req(path!,method!),env);
    expect(denied?.status).toBe(404);
    expect(denied?.headers.get("Cache-Control")).toBe("no-store");
  });
  it("redirects landing to Telegram without sending any existing session",()=>{
    const response=enforceRailwayStagingBoundary(req("/"),env);
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("/telegram");
  });
});
