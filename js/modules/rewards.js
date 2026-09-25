// Rewards: points balances, goals, prizes, approvals, and point history.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, avatar, openModal, closeModal, fmtDate, toast, cardHead } from '../utils.js';
import { run, refresh } from '../data.js';
import {
  children, memberById, balanceOf, pendingSpend, awardPoints, starLine, progressBar, goalOf,
  kidsSetupNotice, ICONS, iconPicker, memberOptions, newId,
} from './kids.js';
import { approvalRows } from './chores.js';

export function rewardsFor(memberId) {
  return state.rewards.filter(r => r.is_active && (!r.member_id || r.member_id === memberId));
}

export function pendingClaims() {
  return state.claims.filter(c => c.status === 'pending');
}

// A child's points and the prize they're saving for.
export function kidSummary(m, big = false) {
  const bal = balanceOf(m.id);
  const goal = goalOf(m);
  return `<div class="kid-sum ${big ? 'big' : ''}">
    <div class="kid-sum-top">${avatar(m, big ? 'lg' : '')}<b>${esc(m.display_name)}</b>${starLine(bal)}</div>
    ${goal ? `<div class="goal"><small>Saving for ${esc(goal.icon)} ${esc(goal.title)}: ${Math.min(bal, goal.cost)} / ${goal.cost}</small>
      ${progressBar(bal, goal.cost, m.color)}</div>` : ''}
  </div>`;
}

function claimRows() {
  return pendingClaims().map(c => {
    const m = memberById(c.member_id);
    if (!m) return '';
    const short = balanceOf(m.id) < c.cost;
    return `<div class="approval">${avatar(m)}
      <div class="mr-main"><b>${esc(m.display_name)}</b> wants <b>${esc(c.title)}</b>
        <small>${c.cost} ⭐${short ? ' • not enough points right now' : ''}</small></div>
      <div class="row-actions">
        <button class="btn sm primary" data-action="claim-approve" data-id="${esc(c.id)}">Give it</button>
        <button class="btn sm" data-action="claim-deny" data-id="${esc(c.id)}">Not now</button>
      </div></div>`;
  }).filter(Boolean);
}

function historyRows() {
  if (!state.points.length) return '<p class="muted">Points earned and spent will show up here.</p>';
  return state.points.slice(0, 30).map(p => {
    const m = memberById(p.member_id);
    return `<div class="hist">
      <span>${m ? avatar(m) : ''}</span>
      <div class="mr-main">${esc(p.reason)}<small>${m ? esc(m.display_name) : ''} • ${fmtDate(new Date(p.created_at), { weekday: 'short', month: 'short', day: 'numeric' })}</small></div>
      <strong class="${p.amount < 0 ? 'minus' : 'plus'}">${p.amount > 0 ? '+' : ''}${p.amount}</strong>
    </div>`;
  }).join('');
}

function rewardRow(r) {
  const m = r.member_id ? memberById(r.member_id) : null;
  return `<div class="member-row">
    <span class="big-ic">${esc(r.icon)}</span>
    <div class="mr-main"><b>${esc(r.title)}</b><small>${r.cost} ⭐ • ${m ? `Only ${esc(m.display_name)}` : 'Any child'}</small></div>
    <div class="row-actions">
      <button class="icon-btn" data-action="reward-edit" data-id="${esc(r.id)}" title="Edit" aria-label="Edit ${esc(r.title)}">✏️</button>
      <button class="icon-btn" data-action="reward-delete" data-id="${esc(r.id)}" title="Delete" aria-label="Delete ${esc(r.title)}">🗑️</button>
    </div></div>`;
}

export function view() {
  const title = `<div class="page-title"><h2>⭐ Rewards</h2>
    <div class="row-actions"><button class="btn" data-action="points-give">＋/− Points</button>
    <button class="btn primary" data-action="reward-new">＋ New reward</button></div></div>`;
  if (state.kidsMissing) return title + kidsSetupNotice('rewards');
  const kids = children();
  const approvals = [...approvalRows(), ...claimRows()];
  const active = state.rewards.filter(r => r.is_active);
  return `${title}
    ${approvals.length ? `<div class="panel"><h3>👀 Waiting for your OK (${approvals.length})</h3>${approvals.join('')}</div>` : ''}
    <div class="kid-grid">${kids.length ? kids.map(m => `<div class="panel">${kidSummary(m, true)}
        <div class="field"><label for="goal-${esc(m.id)}">Saving for</label>
          <select id="goal-${esc(m.id)}" data-toggle="goal-set" data-member="${esc(m.id)}">
            <option value="">No goal yet</option>
            ${rewardsFor(m.id).map(r => `<option value="${esc(r.id)}" ${r.id === m.goal_reward_id ? 'selected' : ''}>${esc(r.icon)} ${esc(r.title)} (${r.cost} ⭐)</option>`).join('')}
          </select></div></div>`).join('')
      : `<div class="panel empty"><p>Add your kids as family members in <a href="#/settings">Settings</a> to start earning points.</p></div>`}
    </div>
    <div class="settings-grid">
      <section class="panel"><h3>🎁 Rewards to earn</h3>
        ${active.length ? active.map(rewardRow).join('') : '<p class="muted">No rewards yet. Add prizes like "Ice cream trip, 20 ⭐" or "30 minutes of games, 10 ⭐".</p>'}
      </section>
      <section class="panel"><h3>📜 Point history</h3>${historyRows()}</section>
    </div>`;
}

// Home card
export function homeCard() {
  const head = cardHead('⭐', 'Rewards', 'rewards');
  if (state.kidsMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.6 database update to turn on rewards. See the README.</div></div>`;
  const kids = children();
  const waiting = state.completions.filter(c => c.status === 'pending').length + pendingClaims().length;
  const body = kids.length
    ? kids.map(m => kidSummary(m)).join('')
    : '<div class="empty-mini">Add your kids in <a href="#/settings">Settings</a> to start earning points.</div>';
  return `<div class="card">${head}${body}
    ${waiting ? `<a class="more attention" href="#/rewards">👀 ${waiting} waiting for your OK</a>` : ''}</div>`;
}

function rewardForm(r = {}) {
  const isNew = !r.id;
  return `<h2>${isNew ? 'New reward' : 'Edit reward'}</h2>
    <form data-form="reward-save">
      <input type="hidden" name="id" value="${esc(r.id || '')}">
      <div class="field"><label for="rw-title">Reward</label>
        <input id="rw-title" name="title" required maxlength="80" value="${esc(r.title || '')}" placeholder="e.g., Ice cream trip"></div>
      <div class="field"><label>Icon</label>${iconPicker('icon', ICONS.reward, r.icon)}</div>
      <div class="field-row">
        <div class="field"><label for="rw-cost">Cost in points</label>
          <input id="rw-cost" type="number" name="cost" min="1" max="100000" required value="${esc(r.cost ?? 20)}"></div>
        <div class="field"><label for="rw-who">For</label>
          <select id="rw-who" name="member_id">${memberOptions(children(), r.member_id, 'Any child')}</select></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add reward' : 'Save changes'}</button>
      </div>
    </form>`;
}

function pointsForm() {
  return `<h2>Give or take points</h2>
    <form data-form="points-save">
      <div class="field-row">
        <div class="field"><label for="pt-who">Who</label>
          <select id="pt-who" name="member_id" required>${memberOptions(children())}</select></div>
        <div class="field"><label for="pt-amt">Points</label>
          <input id="pt-amt" type="number" name="amount" min="1" max="1000" required value="5"></div>
      </div>
      <div class="field"><label for="pt-dir">Give or take</label>
        <select id="pt-dir" name="dir"><option value="give">Give ⭐ (bonus)</option><option value="take">Take away</option></select></div>
      <div class="field"><label for="pt-why">Why</label>
        <input id="pt-why" name="reason" required maxlength="100" placeholder="e.g., Helped carry groceries"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;
}

const refreshPoints = () => { refresh('balances'); refresh('points'); };

export const actions = {
  'reward-new': () => openModal(rewardForm()),
  'reward-edit': el => openModal(rewardForm(state.rewards.find(r => r.id === el.dataset.id))),
  'reward-delete': async el => {
    if (!confirm('Remove this reward? Points already spent are kept in the history.')) return;
    // Hide instead of deleting, so past requests keep their names
    if (await run(sb.from('rewards').update({ is_active: false }).eq('id', el.dataset.id), 'Reward removed')) refresh('rewards');
  },
  'points-give': () => {
    if (!children().length) { toast('Add a child in Settings first.', 'error'); return; }
    openModal(pointsForm());
  },
  'claim-approve': async el => {
    const c = state.claims.find(x => x.id === el.dataset.id);
    if (!c) return;
    const bal = balanceOf(c.member_id);
    if (bal < c.cost && !confirm(`${memberById(c.member_id)?.display_name || 'They'} only has ${bal} ⭐. Give it anyway? Their balance will go below zero.`)) return;
    const ok = await run(sb.from('reward_claims').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', c.id));
    if (ok) {
      await awardPoints(c.member_id, -c.cost, `🎁 ${c.title}`, 'reward', `claim:${c.id}`);
      const m = memberById(c.member_id);
      if (m?.goal_reward_id && m.goal_reward_id === c.reward_id) {
        await run(sb.from('family_members').update({ goal_reward_id: null }).eq('id', m.id));
        refresh('members');
      }
      toast('Enjoy! 🎉', 'success');
      refresh('claims');
      refreshPoints();
    }
  },
  'claim-deny': async el => {
    if (await run(sb.from('reward_claims').update({ status: 'denied', decided_at: new Date().toISOString() }).eq('id', el.dataset.id))) refresh('claims');
  },
  // Kid mode: ask for a reward
  'claim-new': async el => {
    const r = state.rewards.find(x => x.id === el.dataset.id);
    const kid = state.kidId;
    if (!r || !kid) return;
    if (balanceOf(kid) - pendingSpend(kid) < r.cost) { toast('Not enough stars yet. Keep going!', 'error'); return; }
    if (!confirm(`Ask for ${r.title} for ${r.cost} ⭐?`)) return;
    const ok = await run(sb.from('reward_claims').insert({
      id: newId(), family_id: state.me.family_id, reward_id: r.id, member_id: kid, title: `${r.icon} ${r.title}`, cost: r.cost, status: 'pending',
    }), 'Asked! A parent will say OK.');
    if (ok) refresh('claims');
  },
};

export const toggles = {
  'goal-set': async el => {
    const ok = await run(sb.from('family_members').update({ goal_reward_id: el.value || null }).eq('id', el.dataset.member), 'Goal saved');
    if (ok) refresh('members');
  },
};

export const forms = {
  'reward-save': async d => {
    const row = {
      title: d.title.trim(),
      icon: d.icon || ICONS.reward[0],
      cost: Math.max(1, Math.min(100000, parseInt(d.cost, 10) || 1)),
      member_id: d.member_id || null,
    };
    if (!row.title) return;
    const query = d.id
      ? sb.from('rewards').update(row).eq('id', d.id)
      : sb.from('rewards').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Reward saved' : 'Reward added')) {
      closeModal();
      refresh('rewards');
    }
  },
  'points-save': async d => {
    const n = Math.max(1, Math.min(1000, parseInt(d.amount, 10) || 0));
    const amount = d.dir === 'take' ? -n : n;
    if (await awardPoints(d.member_id, amount, d.reason.trim() || (amount > 0 ? 'Bonus' : 'Points taken away'), amount > 0 ? 'bonus' : 'adjust')) {
      closeModal();
      toast(amount > 0 ? `+${n} ⭐ given` : `${n} ⭐ taken away`, 'success');
      refreshPoints();
    }
  },
};
