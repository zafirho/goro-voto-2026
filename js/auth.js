// ══════════════════════════════════════════════
//  auth.js — Google + Phone authentication
// ══════════════════════════════════════════════
import { auth, db, showScreen, showToast } from './firebase-init.js';
import {
  GoogleAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithPopup,
  signInWithPhoneNumber,
  signInWithCredential,
  signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let confirmResult = null;

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
  initRecaptcha();
}

function initRecaptcha() {
  if (!window._rcv) {
    window._rcv = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {}
    });
  }
}

export async function sendSMS() {
  const prefix = document.getElementById('phone-prefix').value.trim();
  const num    = document.getElementById('phone-number').value.trim().replace(/\s/g,'');
  if (num.length < 8) { showToast('Numero non valido'); return; }

  const btn = document.getElementById('btn-send-sms');
  btn.disabled = true; btn.textContent = 'Invio…';

  try {
    confirmResult = await signInWithPhoneNumber(auth, prefix + num, window._rcv);
    document.getElementById('otp-sent-to').textContent =
      `Codice inviato al ${prefix + num}.`;
    document.getElementById('phone-step-1').style.display = 'none';
    document.getElementById('phone-step-2').style.display = '';
    setupOTPInputs();
    document.getElementById('otp-0').focus();
  } catch(e) {
    showToast('Errore invio SMS. Controlla il numero e riprova.');
    btn.disabled = false; btn.textContent = 'Invia SMS';
    resetRecaptcha();
  }
}

function setupOTPInputs() {
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`otp-${i}`);
    el.value = '';
    el.oninput = e => {
      if (e.target.value.length === 1 && i < 5)
        document.getElementById(`otp-${i+1}`).focus();
      const code = getOTPCode();
      if (code.length === 6) verifyOTP();
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
  resetRecaptcha();
}

function resetRecaptcha() {
  try { window._rcv?.clear(); } catch(e) {}
  window._rcv = null;
}

// ── Sign Out ──────────────────────────────────
export async function signOutUser() {
  await fbSignOut(auth);
  showScreen('screen-hero');
}

// ── Admin check ───────────────────────────────
export async function isAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch(e) {
    return false;
  }
}

// ── Expose to window (chiamati da HTML inline) ─
window.signInWithGoogle  = signInWithGoogle;
window.showPhoneAuth     = showPhoneAuth;
window.sendSMS           = sendSMS;
window.verifyOTP         = verifyOTP;
window.backToPhoneStep1  = backToPhoneStep1;
window.signOutUser       = signOutUser;
