import { BrandMark } from "./components/BrandMark.js";
import {createRoot} from "react-dom/client";
import "./App.css";
import "./commercial-precision.css";
import {PublicLicenseOffers} from "./components/PublicLicenseOffers.js";
import {CamachoCommercialDomains} from "@pos-platform/contracts";
const root=document.getElementById("root");if(!root)throw Error("Elemento raíz no disponible");
createRoot(root).render(<main className="pos-main"><header className="pos-admin-header"><BrandMark variant="header" /><h1>Planes de Camacho POS Colombia</h1><a href={CamachoCommercialDomains.publicOrigin+CamachoCommercialDomains.webLoginPath}>Iniciar sesión</a></header><PublicLicenseOffers/></main>);
