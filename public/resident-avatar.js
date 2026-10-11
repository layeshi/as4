import { h } from './dom.js';
export const avatarURL = a => a.avatar ? `/api/public/avatars/${a.avatar}` : '/roles/default.svg';
export function residentAvatar(a,large=false) {
  return h('img',{class:`resident-avatar${large?' large':''}`,src:avatarURL(a),alt:`${a.name}的形象`,loading:'lazy',onError:e=>{e.currentTarget.onerror=null;e.currentTarget.src='/roles/default.svg';}});
}
