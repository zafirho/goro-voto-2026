// ══════════════════════════════════════════════
//  auth.js — Google + Phone authentication
// ══════════════════════════════════════════════
import { auth, db, showScreen, showToast } from './firebase-init.js';
import {
  GoogleAuthProvider,
  PhoneAuthProvider,
  signInWithPopup,
  signInWithPhoneNumber,
  signInWithCredential,
  signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const RECAPTCHA_SITE_KEY = '6LfnToUsAAAAAJZ_P6iO-8dzp1cF8g6pprriUKW8';

let confirmResult  = null;

// ── Google Login ──────────────────────────────
export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') showToast('Accesso non riuscito. Riprova.');
  }
}

// ── Phone Login ───────────────────────────────
export function showPhoneAuth() {
  showScreen('screen-phone');
  document.getElementById('phone-step-1').style.display = '';
  document.getElementById('phone-step-2').style.display = 'none';
  document.body.classList.add('show-recaptcha');
}

// Ottieni token reCAPTCHA Enterprise, con attesa se lo script non è ancora pronto
function getRecaptchaToken() {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (typeof grecaptcha === 'undefined' || !grecaptcha.enterprise) {
        setTimeout(run, 300);
        return;
      }
      grecaptcha.enterprise.ready(async () => {
        try {
          const token = await grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: 'LOGIN' });
          resolve(token);
        } catch(e) {
          reject(e);
        }
      });
    };
    run();
  });
}

export async function sendSMS() {
  const prefix = document.getElementById('phone-prefix').value.trim();
  const num    = document.getElementById('phone-number').value.trim().replace(/\s/g,'');
  if (num.length < 8) { showToast('Numero non valido'); return; }

  const fullNumber = prefix + num;
  const btn = document.getElementById('btn-send-sms');
  btn.disabled = true; btn.textContent = 'Invio…';

  try {
    // Ottieni token reCAPTCHA Enterprise
    await getRecaptchaToken();

    // Firebase Phone Auth usa internamente reCAPTCHA Enterprise se
    // è presente lo script Enterprise nel DOM — passa null come verifier
    confirmResult = await signInWithPhoneNumber(auth, fullNumber, null);

    document.getElementById('otp-sent-to').textContent = `Codice inviato al ${fullNumber}.`;
    document.getElementById('phone-step-1').style.display = 'none';
    document.getElementById('phone-step-2').style.display = '';
    setupOTPInputs();
    document.getElementById('otp-0').focus();

  } catch(e) {
    console.error('Phone auth error:', e.code, e.message);
    let msg = 'Errore invio SMS. Riprova.';
    if (e.code === 'auth/invalid-phone-number')  msg = 'Numero non valido. Usa il formato internazionale.';
    if (e.code === 'auth/too-many-requests')      msg = 'Troppi tentativi. Riprova tra qualche minuto.';
    if (e.code === 'auth/captcha-check-failed')   msg = 'Verifica reCAPTCHA fallita. Ricarica la pagina.';
    if (e.code === 'auth/quota-exceeded')         msg = 'Quota SMS esaurita per oggi.';
    showToast(msg + ' [' + (e.code||e.message) + ']');
    btn.disabled = false; btn.textContent = 'Invia SMS';
  }
}

function setupOTPInputs() {
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`otp-${i}`);
    el.value = '';
    el.oninput = e => {
      if (e.target.value.length === 1 && i < 5)
        document.getElementById(`otp-${i+1}`).focus();
      if (getOTPCode().length === 6) verifyOTP();
    };
    el.onkeydown = e => {
      if (e.key === 'Backspace' && !el.value && i > 0)
        document.getElementById(`otp-${i-1}`).focus();
    };
  }
}

function getOTPCode() {
  return Array.from({length:6}, (_,i) => document.getElementById(`otp-${i}`).value).join('');
}

export async function verifyOTP() {
  const code = getOTPCode();
  if (code.length < 6) { showToast('Inserisci tutte le 6 cifre'); return; }
  const btn = document.getElementById('btn-verify-otp');
  btn.disabled = true; btn.textContent = 'Verifica…';
  try {
    const cred = PhoneAuthProvider.credential(confirmResult.verificationId, code);
    await signInWithCredential(auth, cred);
    // onAuthStateChanged in vote.js gestirà il redirect
  } catch(e) {
    showToast('Codice non corretto. Riprova.');
    btn.disabled = false; btn.textContent = 'Verifica e accedi';
    for (let i = 0; i < 6; i++) document.getElementById(`otp-${i}`).value = '';
    document.getElementById('otp-0').focus();
  }
}

export function backToPhoneStep1() {
  document.getElementById('phone-step-1').style.display = '';
  document.getElementById('phone-step-2').style.display = 'none';
  const btn = document.getElementById('btn-send-sms');
  btn.disabled = false; btn.textContent = 'Invia SMS';
}

function hideRecaptchaBadge() {
  document.body.classList.remove('show-recaptcha');
}

// ── Sign Out ──────────────────────────────────
export async function signOutUser() {
  await fbSignOut(auth);
  hideRecaptchaBadge();
  showScreen('screen-hero');
}

// ── Admin check ───────────────────────────────
export async function isAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch(e) { return false; }
}

// ── Expose to window ──────────────────────────
window.signInWithGoogle  = signInWithGoogle;
window.showPhoneAuth     = showPhoneAuth;
window.sendSMS           = sendSMS;
window.verifyOTP         = verifyOTP;
window.backToPhoneStep1  = () => { hideRecaptchaBadge(); backToPhoneStep1(); };
window.signOutUser       = signOutUser;
