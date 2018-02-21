import _ from 'lodash';
import React from 'react';
import { connect } from 'react-redux';

import { cidrEnd, cidrSize, cidrStart } from '../cidr';
import { compose, validate } from '../validate';
import { getDefaultSubnets, getZones, getVpcs, getVpcSubnets, validateSubnets } from '../aws-actions';
import { Loader } from './loader';
import { A, AsyncSelect, Connect, Deselect, DeselectField, DocsA, ExternalLinkIcon, Input, localeNum, Radio, Select, ToggleButton } from './ui';
import { Alert } from './alert';
import { configActions } from '../actions';
import { AWS_DomainValidation } from './aws-domain-validation';
import { KubernetesCIDRs } from './k8s-cidrs';
import { CIDRTooltip, CIDRRow } from './cidr';
import { Field, Form } from '../form';
import { toError, toInFly } from '../utils';

import {
  AWS_ADVANCED_NETWORKING,
  AWS_CONTROLLER_SUBNETS,
  AWS_CONTROLLER_SUBNET_IDS,
  AWS_CREATE_VPC,
  AWS_HOSTED_ZONE_ID,
  AWS_REGION_FORM,
  AWS_SPLIT_DNS,
  AWS_SUBNETS,
  AWS_VPC_CIDR,
  AWS_VPC_FORM,
  AWS_VPC_ID,
  AWS_WORKER_SUBNETS,
  AWS_WORKER_SUBNET_IDS,
  CLUSTER_NAME,
  CLUSTER_SUBDOMAIN,
  DESELECTED_FIELDS,
  POD_CIDR,
  SERVICE_CIDR,
  SPLIT_DNS_ON,
  SPLIT_DNS_OPTIONS,
  VPC_CREATE ,
  VPC_PRIVATE,
  VPC_PUBLIC,
  getAwsZoneDomain,
  selectedSubnets,
} from '../cluster-config';

const DEFAULT_AWS_VPC_CIDR = '10.0.0.0/16';

const {setIn} = configActions;

const toLabel = ({id, instanceCIDR, name}) => `${instanceCIDR} (${name ? `${_.truncate(name, {length: 30})} | ${id}` : id})`;
const toOptions = vs => _.chain(vs).map(v => ({label: toLabel(v), value: v.id})).sortBy('label').value();

const validateVPC = async (data, cc, updatedId, dispatch) => {
  const hostedZoneID = data[AWS_HOSTED_ZONE_ID];
  const privateZone = _.get(cc, ['extra', AWS_HOSTED_ZONE_ID, 'privateZones', hostedZoneID]);
  if (privateZone && hostedZoneID && data[AWS_CREATE_VPC] !== VPC_PRIVATE) {
    return 'Private Route 53 Zones must use an existing private VPC.';
  }

  const isCreate = cc[AWS_CREATE_VPC] === VPC_CREATE;
  const awsVpcId = cc[AWS_VPC_ID];

  if (!isCreate && !awsVpcId) {
    // User hasn't selected a VPC yet. Don't try to validate.
    return;
  }

  // Prevent unnecessary calls to validate API by only continuing if a field relevant to VPC validation has changed
  if ([AWS_ADVANCED_NETWORKING, CLUSTER_SUBDOMAIN].includes(updatedId)) {
    return _.get(cc, toError(AWS_VPC_FORM));
  }

  const getSubnets = subnets => {
    const selected = selectedSubnets(cc, subnets);
    return _.map(selected, (v, k) => isCreate ? {availabilityZone: k, instanceCIDR: v} : {availabilityZone: k, id: v});
  };

  const controllerSubnets = getSubnets(cc[isCreate ? AWS_CONTROLLER_SUBNETS : AWS_CONTROLLER_SUBNET_IDS]);
  const workerSubnets = getSubnets(cc[isCreate ? AWS_WORKER_SUBNETS : AWS_WORKER_SUBNET_IDS]);
  if (_.isEmpty(controllerSubnets) || _.isEmpty(workerSubnets)) {
    return 'You must provide subnets for both masters and workers.';
  }

  const isPrivate = cc[AWS_CREATE_VPC] === VPC_PRIVATE;
  const network = {
    privateSubnets: isPrivate ? _.uniqWith([...controllerSubnets, ...workerSubnets], _.isEqual) : workerSubnets,
    publicSubnets: isPrivate ? [] : controllerSubnets,
    podCIDR: cc[POD_CIDR],
    serviceCIDR: cc[SERVICE_CIDR],
  };

  if (isCreate) {
    network.vpcCIDR = cc[AWS_VPC_CIDR];
  } else {
    network.awsVpcId = awsVpcId;
  }

  const inFlyPath = toInFly(AWS_VPC_FORM);
  setIn(inFlyPath, true, dispatch);
  let result;
  try {
    result = await dispatch(validateSubnets(network))
      .then(json => json.valid ? undefined : json.message);
  } catch (e) {
    result = e.message || e.toString();
  }
  setIn(inFlyPath, false, dispatch);
  return result;
};

const vpcInfoForm = new Form(AWS_VPC_FORM, [
  new Field(AWS_ADVANCED_NETWORKING, {default: false}),
  new Field(AWS_CONTROLLER_SUBNETS, {
    default: {},
    dependencies: [AWS_REGION_FORM],
    getExtraStuff: (dispatch, isNow) => dispatch(getDefaultSubnets(null, null, isNow)),
  }),
  new Field(AWS_CONTROLLER_SUBNET_IDS, {
    default: {},
    dependencies: [AWS_VPC_ID],
    getExtraStuff: (dispatch, isNow, cc) => _.isEmpty(cc[AWS_VPC_ID])
      ? Promise.resolve()
      : dispatch(getVpcSubnets({vpcID: cc[AWS_VPC_ID]})),
  }),
  new Field(AWS_CREATE_VPC, {default: VPC_CREATE}),
  new Field(AWS_HOSTED_ZONE_ID, {
    default: '',
    dependencies: [AWS_REGION_FORM],
    validator: (value, cc) => {
      const empty = validate.nonEmpty(value);
      if (empty) {
        return empty;
      }
      if (!getAwsZoneDomain(cc)) {
        return 'Unknown zone ID.';
      }
    },
    getExtraStuff: (dispatch, isNow) => dispatch(getZones(null, null, isNow))
      .then(zones => {
        if (!isNow()) {
          return;
        }
        const zoneToName = {};
        const privateZones = {};
        const options = zones.map(({label, value}) => {
          const id = value.split('/hostedzone/')[1];
          if (label.endsWith('(private)')) {
            privateZones[id] = true;
          }
          zoneToName[id] = label.split(' ')[0];
          return {
            label,
            value: id,
          };
        });
        return {options: _.sortBy(options, 'label'), zoneToName, privateZones};
      }),
  }),
  new Field(AWS_SPLIT_DNS, {default: SPLIT_DNS_ON}),
  new Field(AWS_VPC_CIDR, {default: DEFAULT_AWS_VPC_CIDR, validator: validate.AWSsubnetCIDR}),
  new Field(AWS_VPC_ID, {
    default: '',
    dependencies: [AWS_REGION_FORM],
    getExtraStuff: dispatch => dispatch(getVpcs()).then(vpcs => ({options: toOptions(vpcs)})),
    ignoreWhen: cc => cc[AWS_CREATE_VPC] === VPC_CREATE,
    validator: validate.nonEmpty,
  }),
  new Field(AWS_WORKER_SUBNETS, {default: {}}),
  new Field(AWS_WORKER_SUBNET_IDS, {default: {}}),
  new Field(CLUSTER_SUBDOMAIN, {default: '', validator: compose(validate.nonEmpty, validate.domainName)}),
  new Field(DESELECTED_FIELDS, {default: {}}),
], {
  dependencies: [POD_CIDR, SERVICE_CIDR],
  validator: validateVPC,
});

const SubnetSelect = connect(
  ({clusterConfig}, {field, subnets}) => ({value: _.find(subnets, {id: _.get(clusterConfig, field)})})
)(
  ({disabled, field, subnets, value}) => <div className="withtooltip">
    <Connect field={field}>
      <Select disabled={disabled} options={toOptions(subnets)}>
        <option disabled value="">Select a subnet</option>
      </Select>
    </Connect>
    {value && <div className="tooltip">
      {localeNum(value.availableIPs)} available IP addresses out of {localeNum(cidrSize(value.instanceCIDR))} total ({cidrStart(value.instanceCIDR)} to {cidrEnd(value.instanceCIDR)})
    </div>}
  </div>
);

const stateToProps = ({aws, clusterConfig: cc}) => {
  // populate subnet selection with all available azs ... many to many :(
  const azs = new Set();
  const availableVpcSubnets = aws.availableVpcSubnets.value;
  _.each(availableVpcSubnets.public, v => {
    azs.add(v.availabilityZone);
  });
  _.each(availableVpcSubnets.private, v => {
    azs.add(v.availabilityZone);
  });

  return {
    advanced: cc[AWS_ADVANCED_NETWORKING],
    availableVpcSubnets: aws.availableVpcSubnets,
    awsControllerSubnets: cc[AWS_CONTROLLER_SUBNETS],
    awsCreateVpc: cc[AWS_CREATE_VPC] === VPC_CREATE,
    awsVpc: _.find(aws.availableVpcs.value, {id: cc[AWS_VPC_ID]}),
    awsVpcId: cc[AWS_VPC_ID],
    awsWorkerSubnets: cc[AWS_WORKER_SUBNETS],
    azs: new Array(...azs).sort(),
    clusterName: cc[CLUSTER_NAME],
    clusterSubdomain: cc[CLUSTER_SUBDOMAIN],
    internalCluster: cc[AWS_CREATE_VPC] === VPC_PRIVATE,
  };
};

const dispatchToProps = dispatch => ({
  clearControllerSubnets: () => setIn(AWS_CONTROLLER_SUBNET_IDS, {}, dispatch),
  clearWorkerSubnets: () => setIn(AWS_WORKER_SUBNET_IDS, {}, dispatch),
  getVpcSubnets: vpcID => dispatch(getVpcSubnets({vpcID})),
});

export const AWS_VPC = connect(stateToProps, dispatchToProps)(props => {
  const {awsCreateVpc, availableVpcSubnets, awsVpc, awsVpcId, clusterName, clusterSubdomain, internalCluster, advanced} = props;

  let controllerSubnets;
  let workerSubnets;
  const deselectId = az => `${AWS_SUBNETS}.${az}`;
  if (awsCreateVpc) {
    controllerSubnets = _.map(props.awsControllerSubnets, (subnet, az) => {
      return <DeselectField key={az} field={deselectId(az)}>
        <CIDRRow
          deselectId={deselectId(az)}
          field={`${AWS_CONTROLLER_SUBNETS}.${az}`}
          name={az}
          placeholder="10.0.0.0/24"
          validator={validate.AWSsubnetCIDR}
        />
      </DeselectField>;
    });
    workerSubnets = _.map(props.awsWorkerSubnets, (subnet, az) => {
      return <DeselectField key={az} field={deselectId(az)}>
        <CIDRRow
          deselectId={deselectId(az)}
          field={`${AWS_WORKER_SUBNETS}.${az}`}
          name={az}
          placeholder="10.0.0.0/24"
          validator={validate.AWSsubnetCIDR}
        />
      </DeselectField>;
    });
  } else if (awsVpcId) {
    const buildSubnets = (field, isPrivate) => {
      if (availableVpcSubnets.inFly) {
        return <Loader />;
      }
      const subnets = availableVpcSubnets.value[isPrivate ? 'private' : 'public'];
      if (_.isEmpty(subnets)) {
        return <Alert>{awsVpcId} has no {isPrivate ? 'private' : 'public'} subnets. Please create some using the AWS console.</Alert>;
      }
      return _.map(props.azs, az => <div className="row form-group" key={az}>
        <div className="col-xs-4">
          <Deselect field={deselectId(az)} label={az} />
        </div>
        <div className="col-xs-8">
          <DeselectField field={deselectId(az)}>
            <SubnetSelect field={`${field}.${az}`} subnets={_.filter(subnets, {availabilityZone: az})} />
          </DeselectField>
        </div>
      </div>);
    };

    controllerSubnets = buildSubnets(AWS_CONTROLLER_SUBNET_IDS, internalCluster);
    workerSubnets = buildSubnets(AWS_WORKER_SUBNET_IDS, true);
  }

  return <div>
    <div className="row form-group">
      <div className="col-xs-12">
        <div className="wiz-radio-group">
          <div className="radio wiz-radio-group__radio">
            <label>
              <Connect field={AWS_CREATE_VPC}>
                <Radio name={AWS_CREATE_VPC} value={VPC_CREATE} />
              </Connect>
              Create a new VPC (Public)
            </label>&nbsp;(default)
            <p className="text-muted wiz-help-text">Launch into a new VPC with subnet defaults.</p>
          </div>
        </div>
        <div className="wiz-radio-group">
          <div className="radio wiz-radio-group__radio">
            <label>
              <Connect field={AWS_CREATE_VPC}>
                <Radio name={AWS_CREATE_VPC} value={VPC_PUBLIC} onChange={() => props.clearControllerSubnets()} />
              </Connect>
              Use an existing VPC (Public)
            </label>
            <p className="text-muted wiz-help-text">
              Useful for installing beside existing resources. Your VPC must be <DocsA path="/install/aws/requirements.html#using-an-existing-vpc">set up correctly</DocsA>.
            </p>
          </div>
        </div>
        <div className="wiz-radio-group">
          <div className="radio wiz-radio-group__radio">
            <label>
              <Connect field={AWS_CREATE_VPC}>
                <Radio name={AWS_CREATE_VPC} value={VPC_PRIVATE} onChange={() => props.clearControllerSubnets()} />
              </Connect>
              Use an existing VPC (Private)
            </label>
            <p className="text-muted wiz-help-text">
              Useful for installing beside existing resources. Your VPC must be <DocsA path="/install/aws/requirements.html#using-an-existing-vpc">set up correctly</DocsA>.
            </p>
          </div>
        </div>
      </div>
    </div>

    <hr />

    <p className="text-muted">
      Please select a Route 53 hosted zone. For more information, see AWS Route 53 docs on <A href="https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html">Working with Hosted Zones<ExternalLinkIcon /></A>.
    </p>
    <div className="row form-group">
      <div className="col-xs-2">
        <label htmlFor={CLUSTER_SUBDOMAIN}>DNS</label>
      </div>
      <div className="col-xs-10">
        <div className="row">
          <div className="col-xs-4" style={{paddingRight: 0}}>
            <Connect field={CLUSTER_SUBDOMAIN} getDefault={() => clusterSubdomain || clusterName}>
              <Input placeholder="subdomain" />
            </Connect>
          </div>
          <div className="col-xs-8">
            <Connect field={AWS_HOSTED_ZONE_ID}>
              <AsyncSelect refreshBtn={true} disabledValue="Please select domain" />
            </Connect>
          </div>
        </div>
      </div>
    </div>
    {!internalCluster &&
      <div className="row form-group">
        <div className="col-xs-offset-2 col-xs-10">
          <Connect field={AWS_SPLIT_DNS}>
            <Select>
              {_.map(SPLIT_DNS_OPTIONS, ((k, v) => <option value={v} key={k}>{k}</option>))}
            </Select>
          </Connect>
          <p className="text-muted wiz-help-text">
            See AWS <A href="https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html">Split-View DNS documentation<ExternalLinkIcon /></A>
          </p>
        </div>
      </div>
    }

    <vpcInfoForm.Errors />
    <AWS_DomainValidation />
    <hr />

    {awsCreateVpc && <Connect field={AWS_ADVANCED_NETWORKING}>
      <ToggleButton className="btn btn-default">Advanced Settings</ToggleButton>
    </Connect>
    }
    {(advanced || !awsCreateVpc) && <div>
      {internalCluster && <Alert>
        You must be on a VPN with access to the target VPC. The cluster will have no public endpoints.
      </Alert>}

      {awsCreateVpc &&
        <div>
          <br />
          <Alert>
            The installer will create your EC2 instances within the following CIDR ranges.
            <br /><br />
            Safe defaults have been chosen for you.
            If you make changes, the ranges must not overlap and subnets must be within the VPC CIDR.
          </Alert>
          <div className="row form-group">
            <div className="col-xs-12">
              Specify a range of IPv4 addresses for the VPC in the form of a <A href="https://tools.ietf.org/html/rfc4632">CIDR block<ExternalLinkIcon /></A>. Safe defaults have been chosen for you.
            </div>
          </div>
          <CIDRRow name="CIDR Block" field={AWS_VPC_CIDR} placeholder={DEFAULT_AWS_VPC_CIDR} />
        </div>
      }
      {!awsCreateVpc &&
        <div className="row">
          <div className="col-xs-2">
            <label htmlFor={AWS_VPC_ID}>VPC</label>
          </div>
          <div className="col-xs-10">
            <div className="withtooltip">
              <Connect field={AWS_VPC_ID}>
                <AsyncSelect
                  disabledValue="Please select a VPC"
                  onValue={vpcID => {
                    if (vpcID !== awsVpcId) {
                      props.clearControllerSubnets();
                      props.clearWorkerSubnets();
                    }
                  }}
                  refreshBtn={true}
                />
              </Connect>
              {awsVpc && <CIDRTooltip cidr={awsVpc.instanceCIDR} />}
            </div>
          </div>
        </div>
      }

      {(controllerSubnets || workerSubnets) && <hr />}
      {controllerSubnets && <div className="row form-group">
        <div className="col-xs-12">
          <h4>Masters</h4>
          {controllerSubnets}
        </div>
      </div>
      }
      {workerSubnets && <div className="row form-group">
        <div className="col-xs-12">
          <h4>Workers</h4>
          {workerSubnets}
        </div>
      </div>
      }
      <hr />
      <KubernetesCIDRs autoFocus={false} />
    </div>
    }
  </div>;
});

AWS_VPC.canNavigateForward = ({clusterConfig}) => {
  if (!vpcInfoForm.canNavigateForward({clusterConfig}) || !KubernetesCIDRs.canNavigateForward({clusterConfig})) {
    return false;
  }

  const deselectedSubnets = clusterConfig[DESELECTED_FIELDS][AWS_SUBNETS];
  const isSelected = field => !validate.someSelected(_.keys(clusterConfig[field]), deselectedSubnets);

  if (clusterConfig[AWS_CREATE_VPC] === VPC_CREATE) {
    // The subnet CIDR fields are dynamically generated, so their validators won't automatically invalidate the form
    return _.every(clusterConfig[AWS_CONTROLLER_SUBNETS], subnet => !validate.AWSsubnetCIDR(subnet)) &&
      _.every(clusterConfig[AWS_WORKER_SUBNETS], subnet => !validate.AWSsubnetCIDR(subnet)) &&
      isSelected(AWS_CONTROLLER_SUBNETS) &&
      isSelected(AWS_WORKER_SUBNETS);
  }
  return isSelected(AWS_CONTROLLER_SUBNET_IDS) && isSelected(AWS_WORKER_SUBNET_IDS);
};
