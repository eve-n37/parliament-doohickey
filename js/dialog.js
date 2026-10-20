// In-page confirm dialog and toasts, so nothing depends on window.confirm/alert
// (some in-app and embedded browsers block those or auto-dismiss them).
(function (PB) {
  const esc = PB.esc;
  let root = null;
  let toastBox = null;

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.hidden = true;
    document.body.appendChild(root);

    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }

  // Resolves true if confirmed, false if cancelled (button, Esc or backdrop click).
  PB.ask = ({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) =>
    new Promise((resolve) => {
      ensureRoot();
      const previousFocus = document.activeElement;
      root.innerHTML = `
        <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-msg">
          <h2 id="modal-title">${esc(title)}</h2>
          ${message ? `<p id="modal-msg">${esc(message)}</p>` : ''}
          <div class="modal-actions">
            <button type="button" data-answer="no">${esc(cancelLabel)}</button>
            <button type="button" data-answer="yes" class="${danger ? 'danger-solid' : 'primary'}">${esc(confirmLabel)}</button>
          </div>
        </div>`;
      root.hidden = false;
      const buttons = root.querySelectorAll('button');
      buttons[1].focus();

      const close = (answer) => {
        root.hidden = true;
        root.innerHTML = '';
        root.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        resolve(answer);
      };
      const onClick = (e) => {
        if (e.target === root) return close(false);
        const btn = e.target.closest('[data-answer]');
        if (btn) close(btn.dataset.answer === 'yes');
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        } else if (e.key === 'Tab') {
          // Keep focus inside the dialog.
          e.preventDefault();
          const i = [...buttons].indexOf(document.activeElement);
          buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }
      };
      root.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
    });

  // Short non-blocking message; kind is 'info' or 'error'.
  PB.notify = (message, kind = 'info', ms = 4000) => {
    ensureRoot();
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    toastBox.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    }, ms);
  };
})(window.PB);
