import { byId } from './dom.js';

/** Gestiona la sesión sin mezclar autenticación con los tableros. */
export async function initAuth({ authUrl, onAuthenticated }) {
  const authCheck = await fetch(authUrl || '/api/auth', { cache: 'no-store' });
  const { authenticated } = authCheck.ok ? await authCheck.json() : { authenticated: false };
  const overlay = byId('authOverlay');
  const errorEl = byId('authError');
  const passInput = byId('authPassword');
  const toggleBtn = byId('btnTogglePwd');

  if (authenticated) {
    overlay.classList.add('hidden');
    onAuthenticated();
  } else {
    overlay.classList.remove('hidden');
    passInput.focus();
  }

  toggleBtn.addEventListener('click', () => {
    const isPassword = passInput.type === 'password';
    passInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🔒' : '👁';
  });

  byId('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = 'Verificando…';
    const response = await fetch(authUrl || '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passInput.value })
    });
    if (response.ok) {
      overlay.classList.add('hidden');
      errorEl.textContent = '';
      onAuthenticated();
      return;
    }
    errorEl.textContent = 'Contraseña incorrecta. Inténtalo de nuevo.';
    passInput.value = '';
    passInput.focus();
  });

  byId('btnLogout').addEventListener('click', () => {
    fetch(authUrl || '/api/auth', { method: 'DELETE' }).finally(() => location.reload());
  });
}
