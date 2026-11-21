import { site } from '@/site.config.mjs';
import { basePath } from '@/lib/base-path';

export function baseOptions() {
  return {
    nav: {
      title: (
        <span className="qd-brand">
          {/* Plain <img>: static export, and basePath must be applied by hand. */}
          <img src={`${basePath}/assets/logo.png`} alt="" width={24} height={24} />
          <span>{site.name}</span>
        </span>
      ),
    },
    githubUrl: site.repoUrl,
    links: [
      { text: 'User guide', url: '/docs/user/getting-started/', active: 'nested-url' },
      { text: 'Developer docs', url: '/docs/developer/development/', active: 'nested-url' },
      { text: 'Legal', url: '/docs/legal/terms/', active: 'nested-url' },
      { text: 'Releases', url: `${site.repoUrl}/releases`, external: true },
    ],
  };
}
