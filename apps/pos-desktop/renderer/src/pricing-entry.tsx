import {createRoot} from "react-dom/client";
import "./App.css";
import "./commercial-precision.css";
import {PublicLicenseOffers} from "./components/PublicLicenseOffers.js";
const root=document.getElementById("root");if(!root)throw Error("Elemento raíz no disponible");
createRoot(root).render(<main className="pos-main"><header className="pos-admin-header"><h1>Camacho POS Colombia</h1></header><PublicLicenseOffers/></main>);
