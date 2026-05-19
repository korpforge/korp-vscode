import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '../logger';

describe('Logger', () => {
	let logger: Logger;

	beforeEach(() => {
		logger = Logger.init();
	});

	it('initializes with default info level', () => {
		expect(Logger.getLevel()).toBe('info');
	});

	it('sets level', () => {
		Logger.setLevel('debug');
		expect(Logger.getLevel()).toBe('debug');
		Logger.setLevel('info');
	});

	it('creates child loggers', () => {
		const child = logger.child('test-scope');
		expect(child).toBeDefined();
		// Child should be able to log without throwing
		child.info('test message');
		child.debug('debug message');
		child.warn('warn message');
		child.error('error message');
	});

	it('provides static channel accessor', () => {
		expect(Logger.channel).toBeDefined();
	});
});
