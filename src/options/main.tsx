import { render } from "preact";

import { OptionsApp } from "./OptionsApp";

// X settings anatomy, OS-theme fallback off-x.com: styles.css already keys its
// palette to prefers-color-scheme.
import "@/ui/styles.css";

render(<OptionsApp />, document.getElementById("root") as HTMLElement);
