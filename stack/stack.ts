import {TemplateBuilder} from "@hexlabs/kloudformation-ts";
import {Role} from "@hexlabs/kloudformation-ts/dist/aws/iam/Role";
import {AWS} from "@hexlabs/kloudformation-ts/dist/kloudformation/aws";
import {Iam, iamPolicy, Policy} from "@hexlabs/kloudformation-ts/dist/kloudformation/iam/PolicyDocument";
import {join, Value} from "@hexlabs/kloudformation-ts/dist/kloudformation/Value";
import crypto from 'crypto';

TemplateBuilder.create('bucket.json').build(aws => {
  aws.s3Bucket({
    bucketName: 'klouds-user-template',
    websiteConfiguration: {
      indexDocument: 'template.json',
      errorDocument: 'template.json'
    }
  })
});

export interface ConnectorRequest {
  RoleArn: Value<string>;
  UserIdentifier: Value<string>;
  ReportBucket?: Value<string>;
  ReportBucketRegion?: Value<string>;
  ReportPrefix?: Value<string>;
  ReportName?: Value<string>;
  StackId?: Value<string>;
  Region?: Value<string>;
}

function connectorRole(aws: AWS, uniqueId: Value<string>, principalId: Value<string>, externalId: Value<string>): Role {
  return aws.iamRole({
    roleName: join('klouds-connector-', uniqueId),
    assumeRolePolicyDocument: {
      statement: [{
        effect: 'Allow',
        principal: {AWS: [principalId]},
        action: 'sts:AssumeRole',
        condition: {StringEquals: {_nocaps: true, 'sts:ExternalId': externalId}}
      }]
    },
    managedPolicyArns: ['arn:aws:iam::aws:policy/SecurityAudit'],
    policies: [{
      policyName: 'APIGatewayGETDomainNamePolicy',
      policyDocument: {
        version: '2012-10-17',
        statement: [{
          action: 'apigateway:GET', effect: 'Allow', resource: [
            "arn:aws:apigateway:*::/domainnames",
            "arn:aws:apigateway:*::/domainnames/*",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
          ]
        }]
      }
    }]
  });
}

(function costReportsAndConnector() {
  TemplateBuilder
      .create('end-to-end.json')
      .outputTo('template')
      .params({
        UniqueId: {type: 'String'},
        KloudsUserIdentifier: {
          type: 'String',
          description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
        },
        ConnectorPrincipalId: {
          type: 'String',
          description: 'The principal that is allowed to assume this role, do not change.'
        },
        ConnectorExternalId: {
          type: 'String',
          description: 'The external id used to match the connector when assuming this role, do not change.'
        },
        ConnectorEndpoint: {
          type: 'String',
          description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
        }
      })
      .transformTemplate(t => JSON.stringify({
        ...t,
        Description: "Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io"
      }))
      .build((aws, params) => {
        const bucket = aws.s3Bucket({bucketName: join('klouds-cost-reports-', params.UniqueId())});
        aws.s3BucketPolicy({
          bucket,
          policyDocument: iamPolicy({
            version: '2012-10-17', statement: [
              {
                effect: 'Allow',
                principal: {Service: ['billingreports.amazonaws.com']},
                action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
                resource: bucket.attributes.Arn
              },
              {
                effect: 'Allow',
                principal: {Service: ['billingreports.amazonaws.com']},
                action: ['s3:PutObject'],
                resource: join(bucket.attributes.Arn, '/*')
              }
            ]
          })
        });
        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
        Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucket.attributes.Arn, join(bucket.attributes.Arn, '/*')]));

        const report = aws.curReportDefinition({
          compression: 'GZIP',
          format: 'textORcsv',
          refreshClosedReports: false,
          reportName: `klouds-cost-reports-${crypto.randomBytes(8).toString("hex")}`,
          reportVersioning: 'OVERWRITE_REPORT',
          s3Bucket: bucket,
          s3Prefix: 'costs',
          s3Region: {Ref: 'AWS::Region'},
          timeUnit: 'DAILY',
          additionalSchemaElements: ["RESOURCES"]
        });
        aws.customResource<ConnectorRequest>('KloudsConnector', {
          ServiceToken: params.ConnectorEndpoint(),
          RoleArn: role.attributes.Arn,
          UserIdentifier: params.KloudsUserIdentifier(),
          ReportBucket: {Ref: bucket._logicalName} as any,
          ReportBucketRegion: {Ref: 'AWS::Region'},
          ReportPrefix: 'costs',
          ReportName: {Ref: report._logicalName} as any,
          StackId: {Ref: 'AWS::StackId'},
          Region: {Ref: 'AWS::Region'},
        });

        return {
          outputs: {
            KloudsConnectorRoleArn: {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn}
          }
        }
      });
})();

(function costReportsAndConnectorAllAccounts() {
  TemplateBuilder
    .create('end-to-end-for-stack-set.json')
    .outputTo('template')
    .params({
      UniqueId: {type: 'String'},
      KloudsUserIdentifier: {
        type: 'String',
        description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
      },
      ConnectorPrincipalId: {
        type: 'String',
        description: 'The principal that is allowed to assume this role, do not change.'
      },
      ConnectorExternalId: {
        type: 'String',
        description: 'The external id used to match the connector when assuming this role, do not change.'
      },
      ConnectorEndpoint: {
        type: 'String',
        description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
      }
    })
    .transformTemplate(t => JSON.stringify({
      ...t,
      Description: "Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io"
    }))
    .build((aws, params) => {
      const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
      aws.customResource<ConnectorRequest>('KloudsConnector', {
        ServiceToken: params.ConnectorEndpoint(),
        RoleArn: role.attributes.Arn,
        UserIdentifier: params.KloudsUserIdentifier(),
        StackId: {Ref: 'AWS::StackId'},
        Region: {Ref: 'AWS::Region'},
      });
      return {
        outputs: {
          KloudsConnectorRoleArn: {description: 'Role used by klouds.io to read resources', value: role.attributes.Arn }
        }
      }
    });
})();
(function stackSetStack() {
  TemplateBuilder
    .create('klouds-stack-set.json')
    .params({
      UniqueId: {type: 'String'},
      OrganizationalUnitIds: {type: 'CommaDelimitedList', description: 'A comma seperated list of organizational unit ids, you may also provide the root id if you want all accounts'},
      KloudsUserIdentifier: {
        type: 'String',
        description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
      },
      ConnectorPrincipalId: {
        type: 'String',
        description: 'The principal that is allowed to assume this role, do not change.'
      },
      ConnectorExternalId: {
        type: 'String',
        description: 'The external id used to match the connector when assuming this role, do not change.'
      },
      ConnectorEndpoint: {
        type: 'String',
        description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
      }
    })
    .outputTo('template')
    .transformTemplate(t => JSON.stringify({
      ...t,
      Description: "Generates Stack Sets across all your accounts to connect to klouds.io"
    }))
    .build((aws, params) => {
      const bucket = aws.s3Bucket({bucketName: join('klouds-cost-reports-', params.UniqueId())});
      bucket._deletionPolicy = 'Retain';
      const bucketPolicy = aws.s3BucketPolicy({
        bucket,
        policyDocument: iamPolicy({
          version: '2012-10-17', statement: [
            {
              effect: 'Allow',
              principal: {Service: ['billingreports.amazonaws.com']},
              action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
              resource: bucket.attributes.Arn
            },
            {
              effect: 'Allow',
              principal: {Service: ['billingreports.amazonaws.com']},
              action: ['s3:PutObject'],
              resource: join(bucket.attributes.Arn, '/*')
            }
          ]
        })
      });
      aws.curReportDefinition({
        _dependsOn: [bucket._logicalName!, bucketPolicy._logicalName!],
        compression: 'GZIP',
        format: 'textORcsv',
        refreshClosedReports: false,
        reportName: join('klouds-cost-reports-', params.UniqueId()),
        reportVersioning: 'OVERWRITE_REPORT',
        s3Bucket: bucket,
        s3Prefix: 'costs',
        s3Region: {Ref: 'AWS::Region'},
        timeUnit: 'DAILY',
        additionalSchemaElements: ["RESOURCES"]
      });
      const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
      Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucket.attributes.Arn, join(bucket.attributes.Arn, '/*')] as any));
      const notification = aws.customResource<ConnectorRequest>('KloudsConnector', {
        ServiceToken: params.ConnectorEndpoint(),
        RoleArn: role.attributes.Arn,
        UserIdentifier: params.KloudsUserIdentifier(),
        ReportBucket: bucket.attributes.Arn,
        ReportBucketRegion: {Ref: 'AWS::Region'},
        ReportPrefix: 'costs',
        ReportName: join('klouds-cost-reports-', params.UniqueId()),
        StackId: {Ref: 'AWS::StackId'},
        Region: {Ref: 'AWS::Region'},
      });
      aws.cloudformationStackSet({
        _dependsOn: [notification._logicalName!],
        description: 'Deploys read-only IAM Roles in each account in order to connect to klouds.io',
        autoDeployment: { enabled: true, retainStacksOnAccountRemoval: false },
        permissionModel: 'SERVICE_MANAGED',
        stackSetName: join('klouds-connector', params.UniqueId()),
        capabilities: ['CAPABILITY_NAMED_IAM'],
        operationPreferences: {
          failureTolerancePercentage: 100,
          maxConcurrentPercentage: 100,
        },
        templateURL: 'https://klouds-user-template.s3.eu-west-1.amazonaws.com/end-to-end-for-stack-set.json',
        parameters: [
          { parameterKey: 'UniqueId', parameterValue: params.UniqueId() },
          { parameterKey: 'KloudsUserIdentifier', parameterValue: params.KloudsUserIdentifier() },
          { parameterKey: 'ConnectorPrincipalId', parameterValue: params.ConnectorPrincipalId() },
          { parameterKey: 'ConnectorExternalId', parameterValue: params.ConnectorExternalId() },
          { parameterKey: 'ConnectorEndpoint', parameterValue: params.ConnectorEndpoint() },
        ],
        stackInstancesGroup: [
          {
            regions: ['us-east-1'],
            deploymentTargets: { organizationalUnitIds: params.OrganizationalUnitIds() }
          }
        ]
      });
    });
})();

(function stackSetWithCostReportsStack() {
  TemplateBuilder
    .create('klouds-stack-set-with-cost-reports.json')
    .params({
      UniqueId: {type: 'String'},
      OrganizationalUnitIds: {type: 'CommaDelimitedList', description: 'A comma seperated list of organizational unit ids, you may also provide the root id if you want all accounts'},
      ReportBucket: {
        type: 'String',
        description: 'The Name of the Bucket where Cost and Usage reports are being sent'
      },
      ReportBucketRegion: {
        type: 'String',
        description: 'The Region your Report Bucket was created in'
      },
      ReportPrefix: {
        type: 'String',
        description: 'The Prefix listed for the Cost and Usage Report'
      },
      ReportName: {
        type: 'String',
        description: 'The Name of the Cost and Usage Report'
      },
      KloudsUserIdentifier: {
        type: 'String',
        description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
      },
      ConnectorPrincipalId: {
        type: 'String',
        description: 'The principal that is allowed to assume this role, do not change.'
      },
      ConnectorExternalId: {
        type: 'String',
        description: 'The external id used to match the connector when assuming this role, do not change.'
      },
      ConnectorEndpoint: {
        type: 'String',
        description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
      }
    })
    .outputTo('template')
    .transformTemplate(t => JSON.stringify({
      ...t,
      Description: "Generates Stack Sets across all your accounts to connect to klouds.io"
    }))
    .build((aws, params) => {
      const bucketArn = join("arn:aws:s3:::", params.ReportBucket());
      const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
      Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucketArn, join(bucketArn, '/*')]));

      const notification = aws.customResource<ConnectorRequest>('KloudsConnector', {
        ServiceToken: params.ConnectorEndpoint(),
        RoleArn: role.attributes.Arn,
        UserIdentifier: params.KloudsUserIdentifier(),
        ReportBucket: params.ReportBucket(),
        ReportBucketRegion: params.ReportBucketRegion(),
        ReportPrefix: params.ReportPrefix(),
        ReportName: params.ReportName(),
        StackId: {Ref: 'AWS::StackId'},
        Region: {Ref: 'AWS::Region'},
      });
      aws.cloudformationStackSet({
        _dependsOn: [notification._logicalName!],
        description: 'Deploys read-only IAM Roles in each account in order to connect to klouds.io',
        autoDeployment: { enabled: true, retainStacksOnAccountRemoval: false },
        permissionModel: 'SERVICE_MANAGED',
        stackSetName: join('klouds-connector', params.UniqueId()),
        capabilities: ['CAPABILITY_NAMED_IAM'],
        operationPreferences: {
          failureTolerancePercentage: 100,
          maxConcurrentPercentage: 100,
        },
        templateURL: 'https://klouds-user-template.s3.eu-west-1.amazonaws.com/end-to-end-for-stack-set.json',
        parameters: [
          { parameterKey: 'UniqueId', parameterValue: params.UniqueId() },
          { parameterKey: 'KloudsUserIdentifier', parameterValue: params.KloudsUserIdentifier() },
          { parameterKey: 'ConnectorPrincipalId', parameterValue: params.ConnectorPrincipalId() },
          { parameterKey: 'ConnectorExternalId', parameterValue: params.ConnectorExternalId() },
          { parameterKey: 'ConnectorEndpoint', parameterValue: params.ConnectorEndpoint() },
        ],
        stackInstancesGroup: [
          {
            regions: ['us-east-1'],
            deploymentTargets: { organizationalUnitIds: params.OrganizationalUnitIds() }
          }
        ]
      });
    });
})();

(function costReportsWithReportDetails() {
  TemplateBuilder
      .create('template/end-to-end-manual.json')
      .params({
        UniqueId: {type: 'String'},
        KloudsUserIdentifier: {
          type: 'String',
          description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
        },
        ConnectorPrincipalId: {
          type: 'String',
          description: 'The principal that is allowed to assume this role, do not change.'
        },
        ConnectorExternalId: {
          type: 'String',
          description: 'The external id used to match the connector when assuming this role, do not change.'
        },
        ConnectorEndpoint: {
          type: 'String',
          description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
        },
        ReportBucket: {
          type: 'String',
          description: ''
        },
        ReportBucketRegion: {
          type: 'String',
          description: ''
        },
        ReportPrefix: {
          type: 'String',
          description: ''
        },
        ReportName: {
          type: 'String',
          description: ''
        }
      }).transformTemplate(t => JSON.stringify({
    ...t,
    Description: 'Generates Cost and Usage Reports and creates a cross-account IAM Role with READONLY access for use by klouds.io'
  }))
      .build((aws, params) => {
        const bucketArn = join("arn:aws:s3:::", params.ReportBucket())
        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
        Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [bucketArn, join(bucketArn, '/*')]));

        aws.customResource<ConnectorRequest>('KloudsConnector', {
          _dependsOn: [role],
          ServiceToken: params.ConnectorEndpoint(),
          RoleArn: role.attributes.Arn,
          UserIdentifier: params.KloudsUserIdentifier(),
          ReportBucket: params.ReportBucket(),
          ReportBucketRegion: params.ReportBucketRegion(),
          ReportPrefix: params.ReportPrefix(),
          ReportName: params.ReportName(),
          StackId: {Ref: 'AWS::StackId'},
          Region: {Ref: 'AWS::Region'},
        });

        return {
          outputs: {
            KloudsConnectorRoleArn: {
              description: 'Role used by kloud.io to read resources',
              value: role.attributes.Arn
            },
            KloudsReportBucket: {description: 'The bucket where AWS will create reports', value: params.ReportBucket()},
            KloudsReportBucketRegion: {
              description: 'The Region that the bucket exists in',
              value: params.ReportBucketRegion()
            },
            KloudsReportPrefix: {
              description: 'A prefix applied to place reports into folders',
              value: params.ReportPrefix()
            },
            KloudsReportName: {
              description: 'The name of the reports that will be generated by AWS',
              value: params.ReportName()
            },
          }
        }
      });
})();

(function managementAccountUpdate() {
  TemplateBuilder.create('template/management-account-update.json').params({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {
      type: 'String',
      description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
    },
    ConnectorPrincipalId: {
      type: 'String',
      description: 'The principal that is allowed to assume this role, do not change.'
    },
    ConnectorExternalId: {
      type: 'String',
      description: 'The external id used to match the connector when assuming this role, do not change.'
    },
    ConnectorEndpoint: {
      type: 'String',
      description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
    },
    ReportBucket: {
      type: 'String',
      description: ''
    }
  }).transformTemplate(t => JSON.stringify({
    ...t,
    Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io'
  })).build((aws, params) => {
    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [join('arn:aws:s3:::', params.ReportBucket()), join('arn:aws:s3:::', params.ReportBucket(), '/*')]));

    aws.customResource<ConnectorRequest>('KloudsConnector', {
      _dependsOn: [role],
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier(),
      ReportBucket: params.ReportBucket(),
      StackId: {Ref: 'AWS::StackId'},
      Region: {Ref: 'AWS::Region'},
    });

    return {
      outputs: {
        KloudsConnectorRoleArn: {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn},
        KloudsReportBucket: {description: 'The bucket where AWS will create reports', value: params.ReportBucket()},
      }
    }
  });
})();

(function connectorOnly() {
  TemplateBuilder.create('template/klouds-connector.json').params({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {
      type: 'String',
      description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
    },
    ConnectorPrincipalId: {
      type: 'String',
      description: 'The principal that is allowed to assume this role, do not change.'
    },
    ConnectorExternalId: {
      type: 'String',
      description: 'The external id used to match the connector when assuming this role, do not change.'
    },
    ConnectorEndpoint: {
      type: 'String',
      description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
    }
  }).transformTemplate(t => JSON.stringify({
    ...t,
    Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io'
  }) as any).build((aws, params) => {

    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());

    aws.customResource<ConnectorRequest>('KloudsConnector', {
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier(),
      StackId: {Ref: 'AWS::StackId'},
      Region: {Ref: 'AWS::Region'},
    });

    return {
      outputs: {
        'KloudsConnectorRoleArn': {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn}
      }
    }
  });
})();

(function memberAccountUpdate() {
  TemplateBuilder
      .create('template/member-account-update.json')
      .params({
        UniqueId: {type: 'String'},
        KloudsUserIdentifier: {
          type: 'String',
          description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
        },
        ConnectorPrincipalId: {
          type: 'String',
          description: 'The principal that is allowed to assume this role, do not change.'
        },
        ConnectorExternalId: {
          type: 'String',
          description: 'The external id used to match the connector when assuming this role, do not change.'
        },
        ConnectorEndpoint: {
          type: 'String',
          description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
        },
      })
      .transformTemplate(t => JSON.stringify({
        ...t,
        Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io'
      }))
      .build((aws, params) => {

        const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());

        aws.customResource<ConnectorRequest>('KloudsConnector', {
          ServiceToken: params.ConnectorEndpoint(),
          RoleArn: role.attributes.Arn,
          UserIdentifier: params.KloudsUserIdentifier(),
          StackId: {Ref: 'AWS::StackId'},
          Region: {Ref: 'AWS::Region'},
        });

        return {
          outputs: {
            'KloudsConnectorRoleArn': {
              description: 'Role used by kloud.io to read resources',
              value: role.attributes.Arn
            },
          }
        }
      });
})();

(function connectorWithBucket() {
  TemplateBuilder.create('template/klouds-connector-with-bucket.json').params({
    UniqueId: {type: 'String'},
    KloudsUserIdentifier: {
      type: 'String',
      description: 'A temporary ID used to refer back to the user that requested this in app, do not change.'
    },
    ConnectorPrincipalId: {
      type: 'String',
      description: 'The principal that is allowed to assume this role, do not change.'
    },
    ConnectorExternalId: {
      type: 'String',
      description: 'The external id used to match the connector when assuming this role, do not change.'
    },
    ConnectorEndpoint: {
      type: 'String',
      description: 'The endpoint to send the role arn to when complete so kloud.io can assume this role, do not change.'
    },
    ReportBucketName: {type: 'String', description: 'The bucket where cost reports are sent'},
  }).transformTemplate(t => JSON.stringify({ ...t, Description: 'Creates a cross-account IAM Role with READONLY access for use by klouds.io' })).build((aws, params) => {

    const role = connectorRole(aws, params.UniqueId(), params.ConnectorPrincipalId(), params.ConnectorExternalId());
    Iam.from(role).add('CostReportPolicy', Policy.allow(['s3:ListBucket', 's3:GetObject'], [
      join('arn:aws:s3:::', params.ReportBucketName()),
      join('arn:aws:s3:::', params.ReportBucketName(), '/*')
    ]));
    aws.customResource<ConnectorRequest>('KloudsConnector', {
      ServiceToken: params.ConnectorEndpoint(),
      RoleArn: role.attributes.Arn,
      UserIdentifier: params.KloudsUserIdentifier(),
      StackId: {Ref: 'AWS::StackId'},
      Region: {Ref: 'AWS::Region'},
    });

    return {
      outputs: {
        'KloudsConnectorRoleArn': {description: 'Role used by kloud.io to read resources', value: role.attributes.Arn}
      }
    }
  });

})();
