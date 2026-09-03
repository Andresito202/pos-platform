import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("Elemento raíz #root no encontrado");
createRoot(container).render(<App />);
