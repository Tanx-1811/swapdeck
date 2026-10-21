import { useEffect, useState } from 'react';

/** Hash routes of the manager: #/, #/apps, #/apps/<id>, #/add, #/add/custom?url=…, #/history, … */
export type Route =
  | { name: 'overview' }
  | { name: 'apps' }
  | { name: 'app'; id: string; tab: 'accounts' | 'settings' }
  | { name: 'workspaces' }
  | { name: 'workspace'; id: string | null }
  | { name: 'add' }
  | { name: 'custom'; url: string }
  | { name: 'history' }
  | { name: 'backup' }
  | { name: 'security' }
  | { name: 'settings' }
  | { name: 'help' };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'apps':
      return parts[1]
        ? { name: 'app', id: parts[1], tab: parts[2] === 'settings' ? 'settings' : 'accounts' }
        : { name: 'apps' };
    case 'workspaces':
      return parts[1] ? { name: 'workspace', id: parts[1] === 'new' ? null : parts[1] } : { name: 'workspaces' };
    case 'add':
      return parts[1] === 'custom' ? { name: 'custom', url: params.get('url') ?? '' } : { name: 'add' };
    case 'history':
    case 'backup':
    case 'security':
    case 'settings':
    case 'help':
      return { name: parts[0] };
    default:
      return { name: 'overview' };
  }
}

export function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
