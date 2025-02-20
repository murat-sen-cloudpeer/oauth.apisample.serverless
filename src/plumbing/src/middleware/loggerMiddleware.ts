import middy from '@middy/core';
import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {Container} from 'inversify';
import {BASETYPES} from '../dependencies/baseTypes';
import {LogEntryImpl} from '../logging/logEntryImpl';
import {LoggerFactoryImpl} from '../logging/loggerFactoryImpl';

/*
 * The middleware coded in a class based manner
 */
export class LoggerMiddleware implements middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> {

    private readonly _container: Container;
    private readonly _loggerFactory: LoggerFactoryImpl;

    public constructor(container: Container, loggerFactory: LoggerFactoryImpl) {
        this._container = container;
        this._loggerFactory = loggerFactory;
        this._setupCallbacks();
    }

    /*
     * Start logging when a request begins
     */
    public before(request: middy.Request<APIGatewayProxyEvent, APIGatewayProxyResult>): void {

        // Create the log entry for the current request
        const logEntry = this._loggerFactory.createLogEntry();

        // Bind it to the container
        this._container.rebind<LogEntryImpl>(BASETYPES.LogEntry).toConstantValue(logEntry);

        // Start request logging
        logEntry.start(request.event, request.context);
    }

    /*
     * Finish logging after normal completion
     */
    public after(request: middy.Request<APIGatewayProxyEvent, APIGatewayProxyResult>): void {

        // Get the log entry
        const logEntry = this._container.get<LogEntryImpl>(BASETYPES.LogEntry);

        // End logging
        if (request.response && request.response.statusCode) {
            logEntry.setResponseStatus(request.response.statusCode);
        }
        logEntry.end();
        logEntry.write();
    }

    /*
     * Plumbing to ensure that the this parameter is available in async callbacks
     */
    private _setupCallbacks(): void {
        this.before = this.before.bind(this);
        this.after = this.after.bind(this);
    }
}
