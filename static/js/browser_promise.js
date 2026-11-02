'use strict';
// Legacy jsPDF installs an old Promise polyfill even in current browsers.
// Async functions retain the native constructor; preserve that implementation
// for the application and modern PDF rendering without changing BUP itself.
(() => {
 const NativePromise = (async () => {})().constructor;
 if (window.Promise !== NativePromise) window.Promise = NativePromise;
})();
