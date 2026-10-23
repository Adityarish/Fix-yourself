"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { getPushEnvironment } from "@/lib/notifications/push";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const InstallContext = createContext({
  installed: false,
  ios: false,
  openInstall: () => {},
});
export const useAppInstall = () => useContext(InstallContext);

export function AppInstallProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironment] = useState({
    installed: false,
    ios: false,
  });
  const [ready, setReady] = useState(false);
  const [hasInstalled, setHasInstalled] = useState(false);
  const [promptAvailable, setPromptAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const prompt = useRef<InstallPrompt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const refresh = () => {
      setEnvironment(getPushEnvironment());
      setReady(true);
    };
    refresh();
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const capture = (event: Event) => {
      event.preventDefault();
      prompt.current = event as InstallPrompt;
      setPromptAvailable(true);
    };
    const installed = () => {
      prompt.current = null;
      setPromptAvailable(false);
      setHasInstalled(true);
      refresh();
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("pageshow", refresh);
    displayMode.addEventListener("change", refresh);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("pageshow", refresh);
      displayMode.removeEventListener("change", refresh);
    };
  }, []);

  function openInstall() {
    setMessage("");
    dialog.current?.showModal();
  }
  async function install() {
    const pending = prompt.current;
    if (!pending || busy) return;
    // Browser install prompts can only be used once, including when dismissed.
    prompt.current = null;
    setPromptAvailable(false);
    setBusy(true);
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      setMessage(
        choice.outcome === "accepted"
          ? "Installation requested. Once complete, open NestList from your Home Screen or app launcher."
          : "Installation dismissed. You can still use your browser menu to install later.",
      );
    } catch {
      setMessage(
        "The install prompt is unavailable. Use the browser steps below.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <InstallContext.Provider value={{ ...environment, openInstall }}>
      {ready && !environment.installed && (
        <header className="app-install-header" aria-label="NestList app">
          <span className="app-install-header-label">NestList on your device</span>
          <button
            type="button"
            className="app-install-launcher"
            onClick={openInstall}
            aria-haspopup="dialog"
          >
            {hasInstalled ? (
              <ExternalLink size={16} aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {hasInstalled ? "Open app" : "Install app"}
          </button>
        </header>
      )}
      {children}
      <dialog
        ref={dialog}
        className="app-install-dialog"
        aria-labelledby="app-install-title"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="app-install-content">
          <button
            type="button"
            className="icon-button app-install-close"
            aria-label="Close install guide"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            <X size={20} />
          </button>
          <h2 id="app-install-title">Use NestList as an app</h2>
          <p>
            Keep NestList on your Home Screen and open it in its own window.
          </p>
          {promptAvailable && (
            <button
              type="button"
              className="button"
              onClick={install}
              disabled={busy}
            >
              Install on this device
            </button>
          )}
          {environment.ios ? (
            <>
              <h3>iPhone or iPad</h3>
              <ol>
                <li>
                  Open this website in <strong>Safari</strong>. If you opened it
                  inside another app, use its menu to open in Safari.
                </li>
                <li>
                  Tap <strong>Share</strong> (the square with an upward arrow).
                  You may need to open the page menu first.
                </li>
                <li>
                  Scroll to <strong>Add to Home Screen</strong>. If it is
                  missing, check <strong>Edit Actions</strong> in the Share
                  menu.
                </li>
                <li>
                  Keep <strong>Open as Web App</strong> turned on if shown, then
                  tap <strong>Add</strong>.
                </li>
                <li>
                  Leave Safari and tap the <strong>NestList</strong> icon on
                  your Home Screen.
                </li>
              </ol>
              <p>
                For background notifications, use iOS or iPadOS 16.4 or later,
                open the Home Screen app, then go to Settings → Notifications →
                Enable on this device.
              </p>
            </>
          ) : (
            <>
              <h3>Install from your browser</h3>
              <p>
                On Android, open the browser menu and choose{" "}
                <strong>Install app</strong> or{" "}
                <strong>Add to Home Screen</strong>. In Chrome or Edge on a
                computer, use the install icon in the address bar or the
                browser’s app menu.
              </p>
              <p>
                On Mac in Safari, choose <strong>File → Add to Dock</strong>{" "}
                when available.
              </p>
            </>
          )}
          <p>
            Already installed? Open NestList from your Home Screen, Dock, or app
            launcher. This browser page cannot automatically switch into the
            installed app.
          </p>
          <p role="status">{message}</p>
        </div>
      </dialog>
    </InstallContext.Provider>
  );
}
