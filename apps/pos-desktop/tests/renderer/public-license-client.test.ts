import {it,expect,vi} from "vitest";
import {PublicLicenseClient} from "../../renderer/src/public-license-client.js";
it("public catalog revalidates without credentials, clears invalid cache and never substitutes prices",async()=>{
  const catalog={profile:"CAMACHO_PUBLIC_LICENSE_CATALOG_V1",offers:[]};
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(catalog),{headers:{etag:'"first"'}}))
    .mockResolvedValueOnce(new Response(null,{status:304})).mockResolvedValueOnce(new Response('{"account":"unexpected"}'))
    .mockResolvedValueOnce(new Response(null,{status:304}));
  const client=new PublicLicenseClient("https://central.example.test",transport);
  expect(await client.offers()).toEqual([]);expect(await client.offers()).toEqual([]);
  expect(transport.mock.calls[1]![1]).toMatchObject({credentials:"omit",cache:"no-store",redirect:"error",headers:{"if-none-match":'"first"'}});
  await expect(client.offers()).rejects.toThrow();await expect(client.offers()).rejects.toThrow();
  expect(transport.mock.calls[3]![1]!.headers).toEqual({});
});
