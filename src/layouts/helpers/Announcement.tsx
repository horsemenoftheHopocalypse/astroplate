import config from "@/config/config.json";
import { markdownify } from "@/lib/utils/textConverter";
import React, { useEffect, useState } from "react";

const { enable, message, expire_days } = config.announcement;

const COOKIE_KEY = "announcement-close";

const Cookies = {
  set: (name: string, value: string, options: any = {}) => {
    if (typeof document === "undefined") return;

    const defaults = { path: "/" };
    const opts = { ...defaults, ...options };

    if (typeof opts.expires === "number") {
      opts.expires = new Date(Date.now() + opts.expires * 864e5);
    }
    if (opts.expires instanceof Date) {
      opts.expires = opts.expires.toUTCString();
    }

    let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    for (let key in opts) {
      if (!opts[key]) continue;
      cookieString += `; ${key}`;
      if (opts[key] !== true) {
        cookieString += `=${opts[key]}`;
      }
    }

    document.cookie = cookieString;
  },

  get: (name: string): string | null => {
    if (typeof document === "undefined") return null;

    const cookies = document.cookie.split("; ");
    for (let cookie of cookies) {
      const [key, value] = cookie.split("=");
      if (decodeURIComponent(key) === name) {
        return decodeURIComponent(value);
      }
    }
    return null;
  },
};

const Announcement: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (enable && message && !Cookies.get(COOKIE_KEY)) {
      setIsVisible(true);
    }
  }, []);

  const handleClose = () => {
    Cookies.set(COOKIE_KEY, "true", { expires: expire_days });
    setIsVisible(false);
  };

  if (!enable || !message || !isVisible) {
    return null;
  }

  return (
    <div className="relative z-999 bg-body dark:bg-darkmode-body shadow-[1px_0_10px_7px_rgba(154,154,154,0.11)] pl-4 pr-20 sm:pr-16 py-4 md:text-lg transition-all duration-300">
      <p
        dangerouslySetInnerHTML={{ __html: markdownify(message) }}
        className="text-center text-sm sm:text-base md:text-lg"
      />
      <button
        onClick={handleClose}
        className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer flex items-center justify-center border border-border dark:border-darkmode-border rounded-full text-lg sm:text-base hover:bg-light dark:hover:bg-darkmode-light transition-colors duration-200"
        aria-label="Close announcement"
        style={{
          width: '1.75rem',
          height: '1.75rem',
          minWidth: '1.75rem',
          minHeight: '1.75rem',
          padding: 0
        }}
      >
        &times;
      </button>
    </div>
  );
};

export default Announcement;
