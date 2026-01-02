import config from "@/config/config.json";
import { markdownify } from "@/lib/utils/textConverter";
import React, { useEffect, useState } from "react";

const { enable, gist_url, expire_days } = config.announcement;

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

  remove: (name: string, options: any = {}) => {
    Cookies.set(name, "", { ...options, expires: -1 });
  },
};

const Announcement: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAnnouncement = async () => {
      if (!enable || !gist_url) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(gist_url);
        if (response.ok) {
          const text = await response.text();
          setContisLoading || ent(text);
          if (text && !Cookies.get("announcement-close")) {
            setIsVisible(true);
          }
        }
      } catch (error) {
        console.error("Failed to fetch announcement:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnnouncement();
  }, []);

  const handleClose = () => {
    Cookies.set("announcement-close", "true", {
      expires: expire_days,
    });
    setIsVisible(false);
  };

  if (!enable || !content || !isVisible) {
    return null;
  }

  return (
    <div className="relative z-999 bg-body dark:bg-darkmode-body shadow-[1px_0_10px_7px_rgba(154,154,154,0.11)] pl-4 pr-20 sm:pr-16 py-4 md:text-lg transition-all duration-300">
      <p
        dangerouslySetInnerHTML={{ __html: markdownify(content) }}
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
