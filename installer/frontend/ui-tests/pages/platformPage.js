const wizard = require('../utils/wizard');

const platformPageCommands = {
  test (platformEl) {
    this.expect.element('select#platformType').to.be.visible.before(60000);

    // Platform should default to AWS
    this.expect.element('select#platformType').to.have.value.that.equals('aws-tf');
    this.expect.element(wizard.nextStep).to.be.present;

    this.selectOption('@awsAdvanced');
    this.expect.element(wizard.nextStep).to.not.be.present;
    this.selectOption('@azureAdvanced');
    this.expect.element(wizard.nextStep).to.not.be.present;
    this.selectOption('@metalAdvanced');
    this.expect.element(wizard.nextStep).to.not.be.present;
    this.selectOption('@openstackAdvanced');
    this.expect.element(wizard.nextStep).to.not.be.present;

    this.selectOption(platformEl);
    this.expect.element(wizard.nextStep).to.be.present;
  },
};

module.exports = {
  commands: [platformPageCommands],
  elements: {
    awsAdvanced: 'option[value="aws"]',
    awsGUI: 'option[value="aws-tf"]',
    azureAdvanced: 'option[value="azure"]',
    metalAdvanced: 'option[value="bare-metal"]',
    openstackAdvanced: 'option[value="openstack"]',
  },
};
