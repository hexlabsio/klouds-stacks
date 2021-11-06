import { Value } from "@hexlabs/kloudformation-ts/dist/kloudformation/Value";
export interface ConnectorRequest {
    RoleArn: Value<string>;
    UserIdentifier: Value<string>;
    ReportBucket?: Value<string>;
    ReportBucketRegion?: Value<string>;
    ReportPrefix?: Value<string>;
    ReportName?: Value<string>;
}
