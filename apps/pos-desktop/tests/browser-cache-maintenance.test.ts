import {afterEach,it,expect,vi} from "vitest";
import {BrowserCacheMaintenance} from "../src/browser-cache-maintenance.js";
afterEach(()=>vi.useRealTimers());
it("cache maintenance measures before/after and never clears storage or cookies",async()=>{
  let bytes=4000;const browser={getCacheSize:async()=>bytes,clearCache:vi.fn(async()=>{bytes=0;}),clearStorageData:vi.fn()};
  const maintenance=new BrowserCacheMaintenance(browser,{maximum_cache_bytes:2000,interval_ms:1000});
  expect(await maintenance.run()).toMatchObject({cleared:true,before_bytes:4000,after_bytes:0});expect(browser.clearStorageData).not.toHaveBeenCalled();
  expect(await maintenance.run()).toMatchObject({cleared:false});bytes=1000;expect(await maintenance.run(true)).toMatchObject({cleared:true,before_bytes:1000,after_bytes:0});
});
it("automatic maintenance coalesces concurrent work and stops its timer",async()=>{
  vi.useFakeTimers();let release!:()=>void;const gate=new Promise<void>(r=>release=r),clearCache=vi.fn(async()=>gate);
  const maintenance=new BrowserCacheMaintenance({getCacheSize:async()=>100,clearCache},{maximum_cache_bytes:1,interval_ms:1000});maintenance.start();
  await vi.advanceTimersByTimeAsync(1000);expect(clearCache).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);expect(clearCache).toHaveBeenCalledTimes(1);const pending=maintenance.run(true);release();await pending;await maintenance.stop();
  await vi.advanceTimersByTimeAsync(5000);expect(clearCache).toHaveBeenCalledTimes(1);
});
it("failed cache cleanup is reported and a later manual attempt can succeed",async()=>{
  const clearCache=vi.fn().mockRejectedValueOnce(Error("DISK_FAILURE")).mockResolvedValue(undefined),maintenance=new BrowserCacheMaintenance({getCacheSize:async()=>100,clearCache},{maximum_cache_bytes:1,interval_ms:1000});
  await expect(maintenance.run()).rejects.toThrow("DISK_FAILURE");expect((await maintenance.run()).cleared).toBe(true);
});
it("cache maintenance requires explicit bounds and rejects invalid measurements",async()=>{
  expect(()=>new BrowserCacheMaintenance({getCacheSize:async()=>0,clearCache:async()=>{}},{maximum_cache_bytes:0,interval_ms:1000})).toThrow("POLICY");
  await expect(new BrowserCacheMaintenance({getCacheSize:async()=>-1,clearCache:async()=>{}},{maximum_cache_bytes:1,interval_ms:1000}).run()).rejects.toThrow("MEASUREMENT");
});
