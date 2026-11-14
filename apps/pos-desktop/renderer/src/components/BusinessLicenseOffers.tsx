import {PublicLicenseCatalogSchema} from "@pos-platform/contracts";
import {callCommercial} from "../pos-service.js";
import {PublicLicenseOffers} from "./PublicLicenseOffers.js";
const load=async(signal:AbortSignal)=>{
  const response=await callCommercial<{outcome:string;catalog:unknown}>("license.offers.list",{});
  if(signal.aborted)throw new DOMException("Aborted","AbortError");
  if(response.status!=="SUCCEEDED"||response.result?.outcome!=="AVAILABLE")throw Error("No se pudo consultar el catálogo público de Central.");
  return PublicLicenseCatalogSchema.parse(response.result.catalog).offers;
};
/** Prices available for a new quote are distinct from an existing contract. */
export function BusinessLicenseOffers(){return <><PublicLicenseOffers load={load}/><p>Estos precios no modifican tu contrato. Consulta privada de contrato y vigencia no disponible en esta vista.</p></>;}
