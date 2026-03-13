/**
 * Event emitter — thin wrapper over Node's EventEmitter
 */
import { EventEmitter } from 'node:events';
export function createEventEmitter() {
    const emitter = new EventEmitter();
    const safeCall = (handler, event) => {
        try {
            handler(event);
        }
        catch (err) {
            console.error(`Event handler error for "${event.type}":`, err);
        }
    };
    return {
        emit(event) {
            emitter.emit(event.type, event);
            emitter.emit('*', event);
        },
        on(type, handler) {
            const wrapped = (e) => safeCall(handler, e);
            emitter.on(type, wrapped);
            return () => emitter.off(type, wrapped);
        },
        onAny(handler) {
            const wrapped = (e) => safeCall(handler, e);
            emitter.on('*', wrapped);
            return () => emitter.off('*', wrapped);
        },
    };
}
