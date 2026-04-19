const API_BASE_URL = 'http://localhost:3000';

const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

async function callAuthEndpoint(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
	method: 'POST',
	headers: {
	  'Content-Type': 'application/json',
	},
	body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
	const message = body.message || `Erreur HTTP ${response.status}`;
	throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }

  return body;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status ${isError ? 'error' : 'success'}`;
}

function setResult(data) {
  resultEl.textContent = JSON.stringify(data, null, 2);
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Creation du compte en cours...');

  const formData = new FormData(registerForm);
  const payload = {
	email: formData.get('email'),
	password: formData.get('password'),
  };

  try {
	const result = await callAuthEndpoint('/auth/register', payload);
	setStatus('Compte cree avec succes.');
	setResult(result);
  } catch (error) {
	setStatus(error.message, true);
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Connexion en cours...');

  const formData = new FormData(loginForm);
  const payload = {
	email: formData.get('email'),
	password: formData.get('password'),
  };

  try {
	const result = await callAuthEndpoint('/auth/login', payload);
	setStatus('Connexion reussie.');
	setResult(result);
  } catch (error) {
	setStatus(error.message, true);
  }
});
