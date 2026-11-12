import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// More generous than the default (1 s) so the tests stay stable on slower machines.
configure({ asyncUtilTimeout: 5000 });
