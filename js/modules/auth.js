// Sign in, create account, reset password, and create/join a family.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, toast, openModal, closeModal, friendlyError } from '../utils.js';
import { handleSession } from '../session.js';

const appUrl = () => location.origin + location.pathname;

const MODES = {
  signin: { title: 'Sign in', button: 'Sign in' },
  signup: { title: 'Create your account', button: 'Create account' },
  reset:  { title: 'Reset your password', button: 'Email me a reset link' },
};

export function authView() {
  const mode = MODES[state.authMode] ? state.authMode : 'signin';
  const m = MODES[mode];
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">🏠</div>
    <h1>Family Hub</h1>
    <p class="muted">Our family's command center</p>
    <h2>${m.title}</h2>
    ${state.authNotice ? `<div class="notice">${esc(state.authNotice)}</div>` : ''}
    <form data-form="auth-${mode}">
      <div class="field"><label for="auth-email">Email</label>
        <input id="auth-email" type="email" name="email" autocomplete="email" required></div>
      ${mode === 'reset' ? '' : `<div class="field"><label for="auth-password">Password</label>
        <input id="auth-password" type="password" name="password"
          autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
          ${mode === 'signup' ? 'minlength="8" placeholder="At least 8 characters"' : ''} required></div>`}
      <button class="btn primary block" type="submit">${m.button}</button>
    </form>
    <div class="auth-links">
      ${mode === 'signin'
        ? `<button class="link" data-action="auth-mode" data-mode="signup">New here? Create an account</button>
           <button class="link" data-action="auth-mode" data-mode="reset">Forgot your password?</button>`
        : `<button class="link" data-action="auth-mode" data-mode="signin">Back to sign in</button>`}
    </div>
  </div></div>`;
}

export function onboardingView() {
  return `<div class="auth-wrap"><div class="onboard">
    <h1>Welcome to Family Hub 👋</h1>
    <p>You're signed in as ${esc(state.user.email)}. Let's connect you to your family.</p>
    <div class="onboard-grid">
      <form class="card" data-form="family-create">
        <h3>Start a new family</h3>
        <p class="muted">Choose this if you're the first one setting up Family Hub.</p>
        <div class="field"><label for="ob-family">Family name</label>
          <input id="ob-family" name="family_name" placeholder="e.g., The Smith Family" required maxlength="80"></div>
        <div class="field"><label for="ob-name">Your name</label>
          <input id="ob-name" name="display_name" placeholder="How the family sees you" required maxlength="40"></div>
        <button class="btn primary block" type="submit">Create family</button>
      </form>
      <form class="card" data-form="family-join">
        <h3>Join your family</h3>
        <p class="muted">Already set up by someone else? Enter the invite code from their Settings page.</p>
        <div class="field"><label for="ob-code">Invite code</label>
          <input id="ob-code" name="invite_code" placeholder="8 characters" required maxlength="12" autocapitalize="characters"></div>
        <div class="field"><label for="ob-name2">Your name</label>
          <input id="ob-name2" name="display_name" placeholder="How the family sees you" required maxlength="40"></div>
        <button class="btn primary block" type="submit">Join family</button>
      </form>
    </div>
    <button class="link light" data-action="sign-out">Sign out</button>
  </div></div>`;
}

export function openNewPasswordModal() {
  openModal(`<h2>Choose a new password</h2>
    <form data-form="new-password">
      <div class="field"><label for="np">New password</label>
        <input id="np" type="password" name="password" minlength="8" autocomplete="new-password" required></div>
      <div class="modal-actions"><button class="btn primary" type="submit">Save password</button></div>
    </form>`);
}

async function reloadAfterFamilyChange(message) {
  const { data: { session } } = await sb.auth.getSession();
  await handleSession(session, true);
  if (state.me) toast(message, 'success');
}

export const actions = {
  'auth-mode': el => update({ authMode: el.dataset.mode, authNotice: null }),
  'sign-out': async () => {
    closeModal();
    await sb.auth.signOut();
  },
};

export const forms = {
  'auth-signin': async d => {
    const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
    if (error) {
      toast(/invalid login/i.test(error.message) ? 'That email and password don\'t match. Try again or reset your password.' : friendlyError(error), 'error');
    } else {
      state.authNotice = null;
    }
  },
  'auth-signup': async d => {
    const { data, error } = await sb.auth.signUp({
      email: d.email.trim(), password: d.password,
      options: { emailRedirectTo: appUrl() },
    });
    if (error) return toast(friendlyError(error), 'error');
    if (!data.session) {
      update({ authMode: 'signin', authNotice: 'Check your email for a confirmation link. After you click it, you\'ll be signed in automatically.' });
    }
  },
  'auth-reset': async d => {
    const { error } = await sb.auth.resetPasswordForEmail(d.email.trim(), { redirectTo: appUrl() });
    if (error) return toast(friendlyError(error), 'error');
    update({ authMode: 'signin', authNotice: 'If that email has an account, a reset link is on its way.' });
  },
  'new-password': async d => {
    const { error } = await sb.auth.updateUser({ password: d.password });
    if (error) return toast(friendlyError(error), 'error');
    closeModal();
    toast('Password saved', 'success');
  },
  'family-create': async d => {
    const { error } = await sb.rpc('create_family', {
      p_family_name: d.family_name, p_display_name: d.display_name,
    });
    if (error) return toast(friendlyError(error), 'error');
    await reloadAfterFamilyChange('Your family is ready! 🎉');
  },
  'family-join': async d => {
    const { error } = await sb.rpc('join_family', {
      p_invite_code: d.invite_code, p_display_name: d.display_name,
    });
    if (error) return toast(friendlyError(error), 'error');
    await reloadAfterFamilyChange('You joined your family! 🎉');
  },
};
