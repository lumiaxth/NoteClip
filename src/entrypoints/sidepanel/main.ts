import '@/panel/app.css';
import { mountPanel } from '@/panel/app';
import { initTheme } from '@/settings/theme';
import { t } from '@/utils/i18n';

// Sidebar shows the page title; use the short name for both locales.
document.title = t('panelTitle');
document.documentElement.classList.add('nc-sidepanel');
void initTheme();
void mountPanel(document.getElementById('app')!);
