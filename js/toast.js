// In-page toasts, so nothing depends on window.alert/confirm
// (some in-app and embedded browsers block those or auto-dismiss them).
(function (PB) {
  let toastBox = null;

  function ensureRoot() {
    if (toastBox) return;
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }

  // Short non-blocking message; kind is 'info' or 'error'. An optional action
  // ({ label, onClick }) adds a button that runs once and closes the toast.
  PB.notify = (message, kind = 'info', ms = 4000, action = null) => {
    ensureRoot();
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    };

    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        dismiss();
        action.onClick();
      }, { once: true });
      el.appendChild(btn);
    }

    toastBox.appendChild(el);
    timer = setTimeout(dismiss, ms);
    return dismiss;
  };
})(window.PB);
