import '@/panel/app.css';
import { mountPanel } from '@/panel/app';
import { initTheme } from '@/settings/theme';
import { t } from '@/utils/i18n';

document.title = t('panelTitle');
document.documentElement.classList.add('nc-popup');
void initTheme();
void mountPanel(document.getElementById('app')!);
