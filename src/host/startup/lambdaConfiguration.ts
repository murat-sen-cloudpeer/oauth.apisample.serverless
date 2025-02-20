import middy from '@middy/core';
import cors from '@middy/http-cors';
import {APIGatewayProxyEvent, APIGatewayProxyResult, Context} from 'aws-lambda';
import fs from 'fs-extra';
import {Container} from 'inversify';
import {
    BaseCompositionRoot,
    HttpProxy,
    LoggerFactory,
    LoggerFactoryBuilder,
    ResponseWriter} from '../../plumbing';
import {SampleCustomClaimsProvider} from '../claims/sampleCustomClaimsProvider';
import {Configuration} from '../configuration/configuration';
import {CompositionRoot} from '../dependencies/compositionRoot';

/*
 * A shorthand type for this module
 */
type AsyncHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

/*
 * A class to configure the lambda and manage cross cutting concerns
 */
export class LambdaConfiguration {

    private readonly _container: Container;

    public constructor(container: Container) {
        this._container = container;
    }

    /*
     * Apply cross cutting concerns to a lambda
     */
    public enrichHandler(baseHandler: AsyncHandler)
        : middy.MiddyfiedHandler<APIGatewayProxyEvent, APIGatewayProxyResult> | AsyncHandler {

        const loggerFactory = LoggerFactoryBuilder.create();
        try {

            // Load our JSON configuration
            const configuration = this._loadConfiguration();

            // Create the HTTP proxy object
            const httpProxy = new HttpProxy(configuration.api.useProxy, configuration.api.proxyUrl);

            // Register common code dependencies for logging and error handling
            const base = new BaseCompositionRoot(this._container)
                .useLogging(configuration.logging, loggerFactory)
                .useOAuth(configuration.oauth)
                .withCustomClaimsProvider(new SampleCustomClaimsProvider(), configuration.cache)
                .useHttpProxy(httpProxy)
                .register();

            // Register API specific dependencies
            CompositionRoot.register(this._container);

            // Configure middy middleware classes
            return this._configureMiddleware(baseHandler, base, configuration);

        } catch (e) {

            // Handle any startup exceptions
            return this._handleStartupError(loggerFactory, e);
        }
    }

    /*
     * Load the configuration JSON file
     */
    private _loadConfiguration(): Configuration {
        const configBuffer = fs.readFileSync('api.config.json');
        return JSON.parse(configBuffer.toString()) as Configuration;
    }

    /*
     * Wrap the base handler in cross cutting middleware using the middy component
     */
    private _configureMiddleware(
        baseHandler: AsyncHandler,
        base: BaseCompositionRoot,
        configuration: Configuration)
            : middy.MiddyfiedHandler<APIGatewayProxyEvent, APIGatewayProxyResult> | AsyncHandler {

        // Get framework middleware classes including an authorizer that reads claims from the request context
        const loggerMiddleware = base.getLoggerMiddleware();
        const exceptionMiddleware = base.getExceptionMiddleware();
        const authorizerMiddleware = base.getAuthorizerMiddleware();
        const customHeaderMiddleware = base.getCustomHeaderMiddleware();

        // Wrap the base handler and add middleware for cross cutting concerns
        // This ordering ensures that correct CORS headers are written for error responses
        return middy(async (event: APIGatewayProxyEvent, context: Context) => {
            return baseHandler(event, context);

        })
            .use(loggerMiddleware)
            .use(exceptionMiddleware)
            .use(cors(this._getCorsOptions(configuration)))
            .use(authorizerMiddleware)
            .use(customHeaderMiddleware);
    }

    /*
     * Ensure that any startup errors are logged and then return a handler that will provide the client response
     */
    private _handleStartupError(loggerFactory: LoggerFactory, error: any): AsyncHandler {

        const clientError = loggerFactory.logStartupError(error);
        return async () => {
            return ResponseWriter.objectResponse(500, clientError.toResponseFormat());
        };
    }

    /*
     * Allow trusted web origins to call the lambdas and also to send secure cookies
     */
    private _getCorsOptions(configuration: Configuration): any {

        return {
            origins: configuration.api.trustedOrigins,
            credentials: true,
        };
    }
}
