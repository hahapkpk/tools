// ==UserScript==
// @name         Claude Cassia Response Mock
// @namespace    https://github.com/hahapkpk/tools
// @version      1.1.0
// @description  将 Claude checkout_capabilities 响应改写为 cassia
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(() => {
  "use strict";

  const HOST = "claude.ai";
  const PATH = /^\/api\/organizations\/[^/]+\/subscription\/checkout_capabilities\/?$/;
  const DATA = { checkout_flow: "cassia" };
  const BODY = JSON.stringify(DATA);
  const LENGTH = new TextEncoder().encode(BODY).byteLength;

  function matches(input, method = "GET") {
    try {
      if (String(method).toUpperCase() !== "GET") return null;
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;
      if (!raw) return null;

      const url = new URL(raw, location.href);
      const hostMatched = url.hostname === HOST || url.hostname.endsWith("." + HOST);
      return hostMatched && PATH.test(url.pathname) ? url : null;
    } catch {
      return null;
    }
  }

  function responseFor(original) {
    const headers = new Headers(original.headers);
    ["content-length", "content-encoding", "etag", "content-md5"].forEach((name) => headers.delete(name));
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("content-length", String(LENGTH));
    headers.set("cache-control", "no-store");
    return new Response(BODY, { status: 200, statusText: "OK", headers });
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    const response = await nativeFetch.apply(this, arguments);
    const url = matches(input, method);
    if (!url) return response;
    console.warn("[Cassia Mock] Fetch 响应已改写：", url.href, DATA);
    return responseFor(response);
  };

  const proto = XMLHttpRequest.prototype;
  const info = new WeakMap();
  const nativeOpen = proto.open;
  const nativeGetHeader = proto.getResponseHeader;
  const nativeGetHeaders = proto.getAllResponseHeaders;

  proto.open = function (method, url) {
    info.set(this, { method: String(method || "GET").toUpperCase(), url: String(url) });
    return nativeOpen.apply(this, arguments);
  };

  function matchedXhr(xhr) {
    const request = info.get(xhr);
    return request && xhr.readyState === XMLHttpRequest.DONE
      ? matches(request.url, request.method)
      : null;
  }

  function replaceGetter(name, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor?.get || descriptor.configurable === false) return;
    const nativeGetter = descriptor.get;
    Object.defineProperty(proto, name, {
      ...descriptor,
      get() {
        return matchedXhr(this) ? replacement.call(this, nativeGetter) : nativeGetter.call(this);
      }
    });
  }

  replaceGetter("responseText", function (nativeGetter) {
    return this.responseType === "" || this.responseType === "text" ? BODY : nativeGetter.call(this);
  });
  replaceGetter("response", function (nativeGetter) {
    if (this.responseType === "json") return { ...DATA };
    return this.responseType === "" || this.responseType === "text" ? BODY : nativeGetter.call(this);
  });
  replaceGetter("status", () => 200);
  replaceGetter("statusText", () => "OK");

  proto.getResponseHeader = function (name) {
    if (!matchedXhr(this)) return nativeGetHeader.apply(this, arguments);
    switch (String(name).toLowerCase()) {
      case "content-type": return "application/json; charset=utf-8";
      case "content-length": return String(LENGTH);
      case "cache-control": return "no-store";
      case "content-encoding":
      case "etag":
      case "content-md5": return null;
      default: return nativeGetHeader.apply(this, arguments);
    }
  };

  proto.getAllResponseHeaders = function () {
    if (!matchedXhr(this)) return nativeGetHeaders.apply(this, arguments);
    const headers = String(nativeGetHeaders.apply(this, arguments) || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !["content-type", "content-length", "content-encoding", "cache-control", "etag", "content-md5"].includes(line.split(":", 1)[0].trim().toLowerCase()));
    headers.push("content-type: application/json; charset=utf-8", `content-length: ${LENGTH}`, "cache-control: no-store");
    return headers.join("\r\n") + "\r\n";
  };

  function badge() {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", badge, { once: true });
      return;
    }
    if (document.getElementById("cassia-mock-badge")) return;
    const element = document.createElement("div");
    element.id = "cassia-mock-badge";
    element.textContent = "Cassia Mock ON";
    Object.assign(element.style, {
      position: "fixed", right: "12px", bottom: "12px", zIndex: "2147483647",
      padding: "7px 11px", color: "#fff", background: "#167c3a", borderRadius: "6px",
      fontSize: "12px", fontFamily: "sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,.3)"
    });
    document.documentElement.appendChild(element);
  }

  window.__cassiaMockInstalled = true;
  console.info("[Cassia Mock] 脚本已加载：", location.href);
  badge();
})();