import { JSDOM } from "jsdom"; import _jQuery from "jquery"; const { window } = new JSDOM(""); const jQuery = _jQuery(window);
//! Copyright (c) 2021 Jacek Woźniczak

//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to deal
//! in the Software without restriction, including without limitation the rights
//! to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//! copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:

//! The above copyright notice and this permission notice shall be included in all
//! copies or substantial portions of the Software.

//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//! SOFTWARE.

//! This file has been modified by Q-Prod Jacek Woźniczak to add additional features.
//! The original version is https://github.com/SAP/openui5/blob/master/src/sap.ui.core/src/sap/ui/core/util/MockServer.js
//! with the license:
//! OpenUI5
//! (c) Copyright 2009-2021 SAP SE or an SAP affiliate company.
//! Licensed under the Apache License, Version 2.0 - see https://github.com/SAP/openui5/blob/master/LICENSE.txt.

/**
 * OData Mock Data Generator
 * 
 */
class ODataMockGenerator {
  /**
   * @constructor
   * @param {string} metadata OData metadata XML 
   * @param {Object} [options={}] Generation options and rules
   * @param {number} [options.numberOfEntitiesToGenerate=30] Number of entities to generate for each entity set
   * @param {string} [options.mockDataRootURI=""] Root URI which prefixes __metadata.uri property in the generated entities
   * @param {Object} [options.rules={}] Additional rules
   * @param {string[]} [options.rules.skipMockGeneration=[]] Do not generate data for the given entity sets
   * @param {string[]} [options.rules.distinctValues=[]] Generate only distinct entries (based on the key properties) for the given entity sets 
   * @param {Object} [options.rules.predefined={}] Predefined values for the given entities, see README
   * @param {Object} [options.rules.variables={}] Variables to use in "predefined" rules, see README
   */
  constructor(metadata, options = {}) {
    if (!metadata) {
      throw new Error("metadata not provided");
    }

    if (!options.rules) {
      options.rules = {};
    }

    this._predefinedValuesConfig = options.rules.predefined || {};
    this._skipMockGeneration = options.rules.skipMockGeneration || [];
    this._distinctValues = options.rules.distinctValues || [];
    this._variables = options.rules.variables || {};
    this._numberOfEntities = options.numberOfEntitiesToGenerate || 30;
    this._rootUri = options.mockDataRootURI || "";

    if (this._rootUri.substr(this._rootUri.length - 1) !== "/") {
      this._rootUri = `${this._rootUri}/`;
    }

    this._predefinedChosenValues = {};

    this._prepareMetadata(metadata);
  }

  /**
   * Generates mock data based on the metadata and options passed to the constructor 
   * 
   * @returns {Object} Generated data in form { EntitySet1: [{ ..properties.. }], EntitySet2: [{ .. properties.. }] }
   */
  createMockData() {
    const entitySets = this._findEntitySets(this._oMetadata);
    const entitySetNames = Object.keys(entitySets);

    //exclude adjustments
    this._skipMockGeneration.forEach((element) => {
      if (entitySetNames.find((name) => {
          return name === element;
        })) {

        delete entitySets[element];
      }
    });

    this._findEntityTypes(this._oMetadata);
    this._generateMockdata(entitySets, this._oMetadata);

    return this._oMockdata;
  }

  _prepareMetadata(metadata) {
    try {
      this._oMetadata = jQuery.parseXML(metadata);
    } catch (error) {
      throw new Error(`Metadata parsing error: ${error}`);
    }
  }

  _generateMockdata(mEntitySets, oMetadata) {
    const oMockData = {};
    const sRootUri = this._getRootUri();

    jQuery.each(mEntitySets, (sEntitySetName, oEntitySet) => {
      const mEntitySet = {};
      mEntitySet[oEntitySet.name] = oEntitySet;
      oMockData[sEntitySetName] = this._generateODataMockdataForEntitySet(mEntitySet, oMetadata)[sEntitySetName];
    });

    // changing the values if there is a referential constraint
    jQuery.each(mEntitySets, (sEntitySetName, oEntitySet) => {
      for (const navprop in oEntitySet.navprops) {
        const oNavProp = oEntitySet.navprops[navprop];
        const iPropRefLength = oNavProp.from.propRef.length;
        for (let j = 0; j < iPropRefLength; j++) {
          for (let i = 0; i < oMockData[sEntitySetName].length; i++) {
            // copy the value from the principle to the dependant;
            const oEntity = oMockData[sEntitySetName][i];

            if (this._predefinedValuesConfig[oNavProp.name] &&
              this._predefinedValuesConfig[oNavProp.name][oNavProp.to.propRef[j]]) {
              const chosenValues = this._predefinedChosenValues[oNavProp.name][oNavProp.to.propRef[j]];
              oEntity[oNavProp.from.propRef[j]] = chosenValues[Math.floor(Math.random() * chosenValues.length)];
            } else {
              oMockData[oNavProp.to.entitySet][i][oNavProp.to.propRef[j]] = oEntity[oNavProp.from.propRef[j]];
            }
          }
        }
      }
    });

    // set URIs 
    jQuery.each(mEntitySets, (sEntitySetName, oEntitySet) => {
      jQuery.each(oMockData[sEntitySetName], (iIndex, oEntry) => {
        // add the metadata for the entry
        oEntry.__metadata = {
          uri: sRootUri + sEntitySetName + "(" + this._createKeysString(oEntitySet, oEntry) + ")",
          type: oEntitySet.schema + "." + oEntitySet.type
        };
        // add the navigation properties
        jQuery.each(oEntitySet.navprops, (sKey) => {
          oEntry[sKey] = {
            __deferred: {
              uri: sRootUri + sEntitySetName + "(" + this._createKeysString(oEntitySet, oEntry) + ")/" + sKey
            }
          };
        });
      });
    });

    this._oMockdata = oMockData;
  }

  _generateODataMockdataForEntitySet(mEntitySets, oMetadata) {
    // load the entity sets (map the entity type data to the entity set)
    const oMockData = {};

    // here we need to analyse the EDMX and identify the entity types and complex types
    const mEntityTypes = this._findEntityTypes(oMetadata);
    const mComplexTypes = this._findComplexTypes(oMetadata);

    jQuery.each(mEntitySets, (sEntitySetName, oEntitySet) => {
      oMockData[sEntitySetName] = this._generateDataFromEntitySet(oEntitySet, mEntityTypes, mComplexTypes);
    });

    return oMockData;
  }

  _findEntityTypes(oMetadata) {
    const mEntityTypes = {};
    jQuery(oMetadata).find("EntityType").each((iIndex, oEntityType) => {
      const $EntityType = jQuery(oEntityType);

      mEntityTypes[$EntityType.attr("Name")] = {
        "name": $EntityType.attr("Name"),
        "properties": [],
        "keys": []
      };

      $EntityType.find("Property").each((iIndex, oProperty) => {
        const $Property = jQuery(oProperty);
        const type = $Property.attr("Type");
        mEntityTypes[$EntityType.attr("Name")].properties.push({
          "schema": type.substring(0, type.lastIndexOf(".")),
          "type": type.substring(type.lastIndexOf(".") + 1),
          "name": $Property.attr("Name"),
          "precision": $Property.attr("Precision"),
          "scale": $Property.attr("Scale")
        });
      });

      $EntityType.find("PropertyRef").each((iIndex, oKey) => {
        const $Key = jQuery(oKey);
        const sPropertyName = $Key.attr("Name");
        mEntityTypes[$EntityType.attr("Name")].keys.push(sPropertyName);
      });
    });

    return mEntityTypes;
  }

  _findComplexTypes(oMetadata) {
    const mComplexTypes = {};
    jQuery(oMetadata).find("ComplexType").each((iIndex, oComplexType) => {
      const $ComplexType = jQuery(oComplexType);
      mComplexTypes[$ComplexType.attr("Name")] = {
        "name": $ComplexType.attr("Name"),
        "properties": []
      };

      $ComplexType.find("Property").each((iIndex, oProperty) => {
        const $Property = jQuery(oProperty);
        const type = $Property.attr("Type");
        mComplexTypes[$ComplexType.attr("Name")].properties.push({
          "schema": type.substring(0, type.lastIndexOf(".")),
          "type": type.substring(type.lastIndexOf(".") + 1),
          "name": $Property.attr("Name"),
          "precision": $Property.attr("Precision"),
          "scale": $Property.attr("Scale")
        });
      });
    });

    return mComplexTypes;
  }

  _generateDataFromEntitySet(oEntitySet, mEntityTypes, mComplexTypes) {
    const oEntityType = mEntityTypes[oEntitySet.type];
    let aMockedEntries = [];

    for (let i = 0; i < this._numberOfEntities; i++) {
      aMockedEntries.push(this._generateDataFromEntity(oEntityType, i + 1, mComplexTypes));
    }

    if (this._distinctValues.includes(oEntitySet.name)) {
      aMockedEntries = this._removeDuplicates(aMockedEntries, oEntityType.keys);
    }

    return aMockedEntries;
  }

  _removeDuplicates(generatedData, keyFields) {
    const unique = [];
    const keys = "x".repeat(keyFields.length);
    let insert = true;

    generatedData.forEach((element) => {
      for (let i = 0; i < unique.length; i++) {
        let keyMatch = "";

        keyFields.forEach((key) => {
          if (unique[i][key] === element[key]) {
            keyMatch += "x";
          }
        });

        if (keyMatch === keys) {
          insert = false;
          break;
        }
      }

      if (insert) {
        unique.push(element);
      }

      insert = true;
    });

    return unique;
  }

  _generateDataFromEntity(oEntityType, iIndex, mComplexTypes) {
    const oEntity = {};

    if (!oEntityType) {
      return oEntity;
    }

    for (let i = 0; i < oEntityType.properties.length; i++) {
      const oProperty = oEntityType.properties[i];
      oEntity[oProperty.name] = this._generatePropertyValue(oProperty, mComplexTypes, iIndex, oEntityType, oEntity);
    }

    return oEntity;
  }

  _generatePropertyValue(property, mComplexTypes, iIndexParameter, entityType, entity) {
    //already created?
    if (entity[property.name]) {
      return entity[property.name];
    }

    //predefined?
    if (this._predefinedValuesConfig[entityType.name] &&
      this._predefinedValuesConfig[entityType.name][property.name]) {

      if (!this._predefinedChosenValues[entityType.name]) {
        this._predefinedChosenValues[entityType.name] = {};
      }

      if (!this._predefinedChosenValues[entityType.name][property.name]) {
        this._predefinedChosenValues[entityType.name][property.name] = [];
      }

      const propertyConfig = this._predefinedValuesConfig[entityType.name][property.name];
      let chosenValue;

      if (Array.isArray(propertyConfig)) {
        //array of values
        chosenValue = propertyConfig[Math.floor(Math.random() * propertyConfig.length)];
        this._predefinedChosenValues[entityType.name][property.name].push(chosenValue);
        return chosenValue;
      } else if (typeof propertyConfig === "string" && propertyConfig.indexOf("$ref") !== -1) {
        const variableName = propertyConfig.split(":")[1];

        if (this._variables && this._variables[variableName]) {
          const variable = this._variables[variableName];

          if (Array.isArray(variable)) {
            chosenValue = variable[Math.floor(Math.random() * variable.length)];
            this._predefinedChosenValues[entityType.name][property.name].push(chosenValue);
            return chosenValue;
          } else {
            return variable;
          }
        } else {
          throw `Variable ${propertyConfig} not found`;
        }
      } else {
        //dependent?
        if (propertyConfig.reference) {
          if (entity[propertyConfig.reference]) {
            //already created - get its value
            const referencedValue = entity[propertyConfig.reference];
            //get assigned value
            if (propertyConfig.values) {
              for (const el of propertyConfig.values) {
                if (el.key && el.key === referencedValue) {
                  return el.value ? el.value : "missing value";
                }
              }
            }
          } else {
            //not yet
            //get missing property value
            for (const i in entityType.properties) {
              if (entityType.properties[i].name === propertyConfig.reference) {
                const emptyProperty = entityType.properties[i];
                entity[emptyProperty.name] = this._generatePropertyValue(emptyProperty, mComplexTypes, iIndexParameter, entityType, entity);
                //and run again for current
                return this._generatePropertyValue(property, mComplexTypes, iIndexParameter, entityType, entity);
              }
            }
          }
        }
      }
    }

    //standard way - random values
    let iIndex = iIndexParameter;

    if (!iIndex) {
      iIndex = Math.floor(this._getPseudoRandomNumber("String") * 10000) + 101;
    }

    switch (property.type) {
      case "String":
        return property.name + " " + iIndex;
      case "DateTime": {
        const date = new Date();
        date.setFullYear(2000 + Math.floor(this._getPseudoRandomNumber("DateTime") * 20));
        date.setDate(Math.floor(this._getPseudoRandomNumber("DateTime") * 30));
        date.setMonth(Math.floor(this._getPseudoRandomNumber("DateTime") * 12));
        date.setMilliseconds(0);
        return "/Date(" + date.getTime() + ")/";
      }
      case "Int16":
      case "Int32":
      case "Int64":
        return Math.floor(this._getPseudoRandomNumber("Int") * 10000);
      case "Decimal":
        return Math.floor(this._getPseudoRandomNumber("Decimal") * 1000000) / 100;
      case "Boolean":
        return this._getPseudoRandomNumber("Boolean") < 0.5;
      case "Byte":
        return Math.floor(this._getPseudoRandomNumber("Byte") * 10);
      case "Double":
        return this._getPseudoRandomNumber("Double") * 10;
      case "Single":
        return this._getPseudoRandomNumber("Single") * 1000000000;
      case "SByte":
        return Math.floor(this._getPseudoRandomNumber("SByte") * 10);
      case "Time":
        // ODataModel expects ISO8601 duration format
        return "PT" + Math.floor(this._getPseudoRandomNumber("Time") * 23) + "H" + Math.floor(this._getPseudoRandomNumber("Time") * 59) + "M" + Math.floor(this._getPseudoRandomNumber("Time") * 59) + "S";
      case "Guid":
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
          const r = this._getPseudoRandomNumber("Guid") * 16 | 0,
            v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        }.bind(this));
      case "Binary": {
        const nMask = Math.floor(-2147483648 + this._getPseudoRandomNumber("Binary") * 4294967295);
        let sMask = "";
        /*eslint-disable */
        for (let nFlag = 0, nShifted = nMask; nFlag < 32; nFlag++, sMask += String(nShifted >>> 31), nShifted <<= 1)
        ;

        /*eslint-enable*/
        return sMask;
      }
      case "DateTimeOffset": {
        const date = new Date();
        date.setFullYear(2000 + Math.floor(this._getPseudoRandomNumber("DateTimeOffset") * 20));
        date.setDate(Math.floor(this._getPseudoRandomNumber("DateTimeOffset") * 30));
        date.setMonth(Math.floor(this._getPseudoRandomNumber("DateTimeOffset") * 12));
        date.setMilliseconds(0);
        return "/Date(" + date.getTime() + "+0000)/";
      }
      default:
        return this._generateDataFromEntity(mComplexTypes[property.type], iIndex, mComplexTypes);
    }
  }

  _getPseudoRandomNumber(sType) {
    if (!this._iRandomSeed) {
      this._iRandomSeed = {};
    }
    //eslint-disable-next-line
    if (!this._iRandomSeed.hasOwnProperty(sType)) {
      this._iRandomSeed[sType] = 0;
    }
    this._iRandomSeed[sType] = (this._iRandomSeed[sType] + 11) * 25214903917 % 281474976710655;
    return this._iRandomSeed[sType] / 281474976710655;
  }

  _createKeysString(oEntitySet, oEntry) {
    // creates the key string for an entity
    let sKeys = "";
    if (oEntry) {
      jQuery.each(oEntitySet.keys, (iIndex, sKey) => {
        if (sKeys) {
          sKeys += ",";
        }
        let oKeyValue = oEntry[sKey];
        if (oEntitySet.keysType[sKey] === "Edm.String") {
          oKeyValue = encodeURIComponent("'" + oKeyValue + "'");
        } else if (oEntitySet.keysType[sKey] === "Edm.DateTime") {
          oKeyValue = this._getDateTime(oKeyValue);
          oKeyValue = encodeURIComponent(oKeyValue);
        } else if (oEntitySet.keysType[sKey] === "Edm.Guid") {
          oKeyValue = "guid'" + oKeyValue + "'";
        }
        if (oEntitySet.keys.length === 1) {
          sKeys += oKeyValue;
          return sKeys;
        }
        sKeys += sKey + "=" + oKeyValue;
      });
    }
    return sKeys;
  }

  _findEntitySets(oMetadata) {
    const mEntitySets = {};
    const oPrincipals = jQuery(oMetadata).find("Principal");
    const oDependents = jQuery(oMetadata).find("Dependent");

    jQuery(oMetadata).find("EntitySet").each((iIndex, oEntitySet) => {
      const $EntitySet = jQuery(oEntitySet);
      // split the namespace and the name of the entity type (namespace could have dots inside)
      const aEntityTypeParts = /((.*)\.)?(.*)/.exec($EntitySet.attr("EntityType"));
      mEntitySets[$EntitySet.attr("Name")] = {
        "name": $EntitySet.attr("Name"),
        "schema": aEntityTypeParts[2],
        "type": aEntityTypeParts[3],
        "keys": [],
        "keysType": {},
        "navprops": {}
      };
    });

    // helper function to find the entity set and property reference
    // for the given role name
    const fnResolveNavProp = function(sRole, aAssociation, aAssociationSet, bFrom) {
      const sEntitySet = jQuery(aAssociationSet).find("End[Role='" + sRole + "']").attr("EntitySet");
      const sMultiplicity = jQuery(aAssociation).find("End[Role='" + sRole + "']").attr("Multiplicity");

      const aPropRef = [];
      const aConstraint = jQuery(aAssociation).find("ReferentialConstraint > [Role='" + sRole + "']");
      if (aConstraint && aConstraint.length > 0) {
        jQuery(aConstraint[0]).children("PropertyRef").each((iIndex, oPropRef) => {
          aPropRef.push(jQuery(oPropRef).attr("Name"));
        });
      } else {
        const oPrinDeps = (bFrom) ? oPrincipals : oDependents;
        jQuery(oPrinDeps).each((iIndex, oPrinDep) => {
          if (sRole === (jQuery(oPrinDep).attr("Role"))) {
            jQuery(oPrinDep).children("PropertyRef").each((iIndex, oPropRef) => {
              aPropRef.push(jQuery(oPropRef).attr("Name"));
            });
            return false;
          }
        });
      }

      return {
        "role": sRole,
        "entitySet": sEntitySet,
        "propRef": aPropRef,
        "multiplicity": sMultiplicity
      };
    };

    // find the keys and the navigation properties of the entity types
    jQuery.each(mEntitySets, (sEntitySetName, oEntitySet) => {
      // find the keys
      const $EntityType = jQuery(oMetadata).find("EntityType[Name='" + oEntitySet.type + "']");
      const aKeys = jQuery($EntityType).find("PropertyRef");
      jQuery.each(aKeys, (iIndex, oPropRef) => {
        const sKeyName = jQuery(oPropRef).attr("Name");
        oEntitySet.keys.push(sKeyName);
        oEntitySet.keysType[sKeyName] = jQuery($EntityType).find("Property[Name='" + sKeyName + "']").attr("Type");
      });
      // resolve the navigation properties
      const aNavProps = jQuery(oMetadata).find("EntityType[Name='" + oEntitySet.type + "'] NavigationProperty");
      jQuery.each(aNavProps, (iIndex, oNavProp) => {
        const $NavProp = jQuery(oNavProp);
        const aRelationship = $NavProp.attr("Relationship").split(".");
        const aAssociationSet = jQuery(oMetadata).find("AssociationSet[Association = '" + aRelationship.join(".") + "']");
        const sName = aRelationship.pop();
        const aAssociation = jQuery(oMetadata).find("Association[Name = '" + sName + "']");
        oEntitySet.navprops[$NavProp.attr("Name")] = {
          "name": $NavProp.attr("Name"),
          "from": fnResolveNavProp($NavProp.attr("FromRole"), aAssociation, aAssociationSet, true),
          "to": fnResolveNavProp($NavProp.attr("ToRole"), aAssociation, aAssociationSet, false)
        };
      });
    });

    return mEntitySets;
  }

  _getRootUri() {
    let sUri = this._rootUri;
    sUri = sUri && /([^?#]*)([?#].*)?/.exec(sUri)[1]; // remove URL parameters or anchors
    return sUri;
  }

  _getDateTime(sString) {
    if (!sString) {
      return;
    }

    return "datetime'" + new Date(Number(sString.replace("/Date(", "").replace(")/", ""))).toJSON().substring(0, 19) + "'";
  }
}

export { ODataMockGenerator };
//# sourceMappingURL=bundle.js.map
